import {withReconciliation} from '../../execution/src/index.js';
import {providerFetch} from '../../execution/src/index.js';
import {validateNativeField,validateUdfs,nativeProjection,fieldMatches,type NativeField} from '../../native-fields/src/index.js';
import {assertPersonIdentity} from '../../contracts/src/person-identity.js';
import { assertEntityArea, assertArea, canReadFinance, entityArea } from '../../policy/src/areas.js';
import { decodeInvoicePdf } from "./invoice-pdf.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  AppError,
  actorKey,
  positiveId,
  type JournalRecord,
  type Principal,
} from "../../contracts/src/index.js";
import { reauthorize, assertCompanyScope } from "../../policy/src/index.js";
import { requestScheduler } from "../../autotask/src/index.js";
import { impersonationHeader } from "../../autotask/src/impersonation.js";
import type { RequestBudgetPort } from "../../autotask/src/budget.js";
import { IntentCipher } from "../../storage/src/intent-cipher.js";
import type { TicketWorkflows } from "../../workflows/src/index.js";
import { canonicalCompanyName } from "../../workflows/src/company-aliases.js";
import * as c from "./contracts.js";
export * from "./contracts.js";

type Row = Record<string, any>;
type Field = {
  name: string;
  dataType: string;
  isRequired: boolean;
  isReadOnly: boolean;
  isQueryable: boolean;
  length?: number;
  isPickList?: boolean;
  picklistValues?: Array<{ value: string; label: string; isActive: boolean }>;
};
const canonical = (v: any): string =>
  Array.isArray(v)
    ? `[${v.map(canonical)}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(",")}}`
      : JSON.stringify(v);
const hash = (v: unknown) =>
  createHash("sha256").update(canonical(v)).digest("hex");
const fail = (
  m: string,
  code:
    | "invalid_input"
    | "missing_metadata"
    | "conflict"
    | "dependency_unavailable" = "invalid_input",
) => new AppError(code, m);
const absent = () =>
  new AppError(
    "not_found_or_inaccessible",
    "Business record not found or inaccessible.",
  );
const has = (p: Principal, cap: string) =>
  (p.capabilities as string[]).includes(cap);
const identity = (p: Principal) =>
  hash({
    tenant: p.tenantId,
    actor: p.objectId,
    resource: p.resourceId,
    mapping: p.mappingVersion,
    policy: p.policyVersion,
    companies: [...p.companyIds].sort(),
    capabilities: [...p.capabilities].sort(),
  });
const project = (entity: c.BusinessEntity, row: Row) =>
  Object.fromEntries(
    c.fields[entity]
      .filter((k) => Object.hasOwn(row, k))
      .map((k) => [k, row[k]]),
  );
const sensitive = (name: string) =>
  /(?:cost|price|rate|amount|balance|tax|margin|currency|revenue|budget|fee|discount|freight|billed|shippingCost|totalCost|unitCost|unitPrice)/i.test(
    name,
  );
const companyFilterField = (entity: c.BusinessEntity) =>
  entity === "PurchaseOrders" ? "purchaseForCompanyID" : "companyID";

export interface BusinessOptions {
  tenantId: string;
  baseUrl: string;
  username: string;
  secret: string;
  integrationCode: string;
  requestBudget: RequestBudgetPort;
  writesEnabled: boolean;
  fetch?: typeof fetch;
  now?: () => number;
}
const financeEntities = new Set<c.BusinessEntity>([
  "Contracts",
  "ContractServices",
  "ContractBlocks",
  "ContractCharges",
  "ContractServiceAdjustments",
  "ContractServiceBundleAdjustments",
  "ContractServiceBundleUnits",
  "ContractServiceUnits",
  "Invoices",
]);
const procurementEntities = new Set<c.BusinessEntity>([
  "Products",
  "InventoryProducts",
  "InventoryItems",
  "InventoryStockedItems",
  "InventoryStockedItemsAdd",
  "InventoryStockedItemsRemove",
  "InventoryStockedItemsTransfer",
  "InventoryTransfers",
  "PurchaseOrders",
  "PurchaseOrderItems",
  "PurchaseOrderItemReceiving",
]);
const projectEntities = new Set<c.BusinessEntity>([
  "Projects",
  "Phases",
  "Tasks",
  "TaskPredecessors",
  "ProjectNotes",
  "TaskNotes",
]);
const assetEntities = new Set<c.BusinessEntity>([
  "ConfigurationItems",
  "ConfigurationItemDnsRecords",
  "ConfigurationItemNotes",
  "Subscriptions",
]);
const companyField = new Set<c.BusinessEntity>([
  "CompanyToDos",
  "Contracts",
  "Invoices",
  "Projects",
  "ConfigurationItems",
  "InventoryStockedItems",
]);
const commandOnly = new Set<c.BusinessEntity>([
  "InventoryStockedItemsAdd",
  "InventoryStockedItemsRemove",
  "InventoryStockedItemsTransfer",
]);
const writeOnly = new Set<c.BusinessEntity>([
  "ContractServiceAdjustments",
  "ContractServiceBundleAdjustments",
  ...commandOnly,
]);
const parentField: Partial<Record<c.BusinessEntity, string>> = {
  ContractServices: "contractID",
  ContractBlocks: "contractID",
  ContractCharges: "contractID",
  ContractServiceAdjustments: "contractID",
  ContractServiceBundleAdjustments: "contractID",
  ContractServiceBundleUnits: "contractID",
  ContractServiceUnits: "contractID",
  Phases: "projectID",
  Tasks: "projectID",
  TaskPredecessors: "successorTaskID",
  ProjectNotes: "projectID",
  TaskNotes: "taskID",
  ConfigurationItemDnsRecords: "installedProductID",
  ConfigurationItemNotes: "configurationItemID",
  Subscriptions: "configurationItemID",
  PurchaseOrderItems: "orderID",
  PurchaseOrderItemReceiving: "purchaseOrderItemID",
};

/** Fixed business routes with metadata-qualified fields and durable, non-replaying writes. */
export class BusinessService {
  private base: URL;
  private cache = new Map<string, { at: number; fields: Field[] }>();
  constructor(
    private core: TicketWorkflows,
    private cipher: IntentCipher,
    private options: BusinessOptions,
  ) {
    if (
      !/^https:\/\/webservices\d+\.autotask\.net\/atservicesrest\/v1\.0\/$/.test(
        options.baseUrl,
      ) ||
      !options.tenantId ||
      [options.username, options.secret, options.integrationCode].some(
        (v) => !v || /[\r\n]/.test(v),
      )
    )
      throw fail("Invalid business configuration.");
    this.base = new URL(options.baseUrl);
  }
  private now() {
    return this.options.now?.() ?? Date.now();
  }
  private async actor(
    p: Principal,
    write = false,
    entity?: c.BusinessEntity,
    fields?: Row,
  ) {
    const fresh = await reauthorize(p, this.core.principals, {
      resourceMaxAgeMs: 240000,
      now: () => new Date(this.now()),
    });
    if (entity) assertEntityArea(fresh, entity, write);
    if (write && entity && fields && ['projects','configuration'].includes(entityArea(entity)??'') && Object.keys(fields).some(sensitive)) assertArea(fresh,'finance',true);
    if (fresh.tenantId !== this.options.tenantId || !fresh.active)
      throw absent();
    if (!has(fresh, "operational.read"))
      throw new AppError("forbidden", "Operational read access is required.");
    if (entity && !has(fresh, "finance.read"))
      throw new AppError(
        "forbidden",
        "Financial read access is required for the business pack.",
      );
    if (write) {
      const required = entity === "CompanyToDos" ? "sales.write" : financeEntities.has(entity!)
        ? "finance.write"
        : projectEntities.has(entity!)
          ? "projects.write"
          : procurementEntities.has(entity!)
            ? "procurement.write"
            : "configuration.write";
      if (!has(fresh, required))
        throw new AppError("forbidden", `Capability ${required} is required.`);
      if (!has(fresh, "finance.write"))
        throw new AppError(
          "forbidden",
          "finance.write is required for all business mutations in this pack.",
        );
      if (!this.options.writesEnabled)
        throw new AppError("forbidden", "Business writes are disabled.");
    }
    return fresh;
  }
  private async request(
    p: Principal,
    path: string,
    method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
    body?: unknown,
    write = false,
    allow404 = false,
    entity?: c.BusinessEntity,
    writeFields?: Row,
    preflight?: () => Promise<void>,
  ) {
    const url = new URL(path, this.base);
    if (
      url.origin !== this.base.origin ||
      !url.pathname.startsWith(this.base.pathname) ||
      url.username ||
      url.password ||
      url.hash
    )
      throw fail("Invalid business route.");
    return requestScheduler.runWithLease(
      actorKey(p),
      15000,
      async () => {
        await this.actor(p, write, entity, writeFields);
        await this.options.requestBudget.take({
          tenantId: p.tenantId,
          actorKey: actorKey(p),
        });
        if (preflight) await preflight();
        await this.actor(p, write, entity, writeFields);
        requestScheduler.assertLeaseIdle(actorKey(p));
        let response: Response;
        try {
          response = await providerFetch('Autotask',this.options.fetch ?? fetch)(url, {
            method,
            body: body === undefined ? undefined : JSON.stringify(body),
            redirect: "error",
            signal: AbortSignal.timeout(20000),
            headers: {
              UserName: this.options.username,
              Secret: this.options.secret,
              ApiIntegrationCode: this.options.integrationCode,
              "Content-Type": "application/json",
              Accept: "application/json",
              ...(write ? impersonationHeader(entity ?? url.pathname.split('/').filter(Boolean).at(-1) ?? '', p.resourceId) : {}),
            },
          });
        } catch {
          throw new AppError(
            write ? "unknown_outcome" : "dependency_unavailable",
            "Business API transport failed; mutations are never automatically repeated.",
          );
        }
        if (response.status === 404 && allow404 && !write) {
          await response.body?.cancel();
          await this.actor(p, false, entity);
          return undefined;
        }
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 404) throw absent();
          throw new AppError(
            response.status === 401 || response.status === 403
              ? "forbidden"
              : response.status === 409
                ? "conflict"
                : write && (response.status >= 500 || response.status === 408)
                  ? "unknown_outcome"
                  : response.status === 429
                    ? "throttled"
                    : write
                      ? "invalid_input"
                      : "dependency_unavailable",
            `Business API returned HTTP ${response.status}. No automatic retry was sent.`,
          );
        }
        if (method === "DELETE" || response.status === 204) return {};
        try {
          const reader = response.body?.getReader();
          if (!reader) throw Error();
          const chunks: Uint8Array[] = [];
          let size = 0;
          try {
            for (;;) {
              const next = await reader.read();
              if (next.done) break;
              size += next.value.byteLength;
              if (size > 2 * 1024 * 1024) throw Error();
              chunks.push(next.value);
            }
          } finally {
            await reader.cancel();
          }
          const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          await this.actor(p, write, entity, writeFields);
          return value;
        } catch {
          throw new AppError(
            write ? "unknown_outcome" : "dependency_unavailable",
            "Invalid business API response.",
          );
        }
      },
      true,
    );
  }
  private async requestBinary(
    p: Principal,
    path: string,
    entity: c.BusinessEntity,
  ) {
    const url = new URL(path, this.base);
    if (
      url.origin !== this.base.origin ||
      !/^Invoices\/[1-9][0-9]*\/InvoicePdf$/.test(path)
    )
      throw fail("Invalid invoice export route.");
    const invoiceId = Number(path.split("/")[1]);
    return requestScheduler.runWithLease(actorKey(p), 15000, async () => {
      await this.actor(p, false, entity);
      await this.options.requestBudget.take({
        tenantId: p.tenantId,
        actorKey: actorKey(p),
      });
      await this.scoped(p, "Invoices", invoiceId);
      await this.actor(p, false, entity);
      requestScheduler.assertLeaseIdle(actorKey(p));
      let response: Response;
      try {
        response = await providerFetch('Autotask',this.options.fetch ?? fetch)(url, {
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(20000),
          headers: {
            UserName: this.options.username,
            Secret: this.options.secret,
            ApiIntegrationCode: this.options.integrationCode,
            Accept: "application/json",
          },
        });
      } catch {
        throw fail(
          "Invoice export transport failed.",
          "dependency_unavailable",
        );
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw fail("Invoice PDF is unavailable.", "dependency_unavailable");
      }
      const reader = response.body?.getReader();
      if (!reader)
        throw fail("Invoice PDF response is empty.", "dependency_unavailable");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const n = await reader.read();
          if (n.done) break;
          size += n.value.byteLength;
          if (size > 6 * 1024 * 1024)
            throw fail(
              "Invoice PDF envelope exceeds the 6 MiB response limit.",
              "dependency_unavailable",
            );
          chunks.push(n.value);
        }
      } finally {
        await reader.cancel();
      }
      let value: unknown;
      try {
        value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw fail(
          "Invoice PDF envelope is invalid.",
          "dependency_unavailable",
        );
      }
      const file = decodeInvoicePdf(value, invoiceId);
      await this.scoped(p, "Invoices", invoiceId);
      await this.actor(p, false, entity);
      return file;
    });
  }
  private async metadata(p: Principal, entity: c.BusinessEntity) {
    await this.actor(p, false, entity);
    let entry = this.cache.get(entity);
    if (!entry || this.now() - entry.at >= 60000) {
      const r = await this.request(
        p,
        `${entity}/entityInformation/fields`,
        "GET",
        undefined,
        false,
        false,
        entity,
      );
      if (
        !Array.isArray(r.fields) ||
        r.fields.some(
          (f: any) =>
            typeof f.name !== "string" || typeof f.dataType !== "string",
        ) ||
        new Set(r.fields.map((f: any) => f.name)).size !== r.fields.length
      )
        throw fail("Invalid business metadata.", "missing_metadata");
      entry = { at: this.now(), fields: r.fields };
      this.cache.set(entity, entry);
    }
    return entry.fields;
  }
  private async udfMetadata(p:Principal,entity:c.BusinessEntity):Promise<NativeField[]>{await this.actor(p,false,entity);const r=await this.request(p,`${entity}/entityInformation/userDefinedFields`,"GET",undefined,false,false,entity);if(!Array.isArray(r.fields))throw fail('UDF metadata unavailable.','missing_metadata');return r.fields;}
  async schema(p: Principal, input: unknown) {
    const { entity,include_udfs } = c.schemaSchema.parse(input);
    const meta = await this.metadata(p, entity);
    return {
      status: "succeeded",
      entity,
      ...(include_udfs?{user_defined_fields:await this.udfMetadata(p,entity)}:{}),
      fields: meta
        .map((f) => ({
          ...f,
          allowed_for_update:c.documentedWrites[entity].includes('update')&&f.name!=='id'&&f.isReadOnly===false&&!(c.documentedCreateOnlyFields[entity]??[]).includes(f.name),
          allowed_for_write: f.name!=='id' &&
            (f.isReadOnly === false || (c.documentedCreateOnlyFields[entity] ?? []).includes(f.name)),
          create_only: (c.documentedCreateOnlyFields[entity] ?? []).includes(f.name),
          protected: /cost|price|rate|amount|balance|tax/i.test(f.name),
        })),
      limitations: [
        "Updates accept native editable fields from current Autotask metadata on documented update routes.",
        "Use userDefinedFields name/value pairs with last-read expected values for the same names. Finance permission is required for UDF access.",
        "Read-only and create-only fields remain unavailable for updates. Native permission and record-state restrictions apply.",
        "Writes return accepted_unverified or unknown_outcome when readback is incomplete; they are never retried automatically.",
      ],
    };
  }
  private visible(p: Principal, entity: c.BusinessEntity) {
    return c.fields[entity].filter(
      (name) => !sensitive(name) || canReadFinance(p) || ['sales','purchasing','inventory'].includes(entityArea(entity)??''),
    );
  }
  private async company(p: Principal, v: string | number) {
    if (typeof v === "number") {
      assertCompanyScope(p, v);
      await this.core.adapter.get(p, "Companies", v);
      return v;
    }
    const name = canonicalCompanyName(v);
    const r = await this.core.adapter.query(p, {
      entity: "Companies",
      filters: [{ field: "companyName", op: "contains", value: name }],
      pageSize: 100,
    });
    if (r.nextCursor) throw fail("Use a more specific company name.");
    const exact = r.items.filter(
      (x) => String(x.companyName).toLowerCase() === name.toLowerCase(),
    );
    const matches = exact;
    if (matches.length !== 1)
      throw fail(
        "Company name is missing or ambiguous; supply its full name or ID.",
      );
    assertCompanyScope(p, matches[0]!.id);
    return matches[0]!.id;
  }
  private async raw(
    p: Principal,
    entity: c.BusinessEntity,
    id: number,
    allow404 = false,
  ) {
    if (!positiveId(id)) throw fail("Invalid record ID.");
    const r = await this.request(
      p,
      `${entity}/${id}`,
      "GET",
      undefined,
      false,
      allow404,
      entity,
    );
    if (r === undefined) return undefined;
    if (!r.item || r.item.id !== id)
      throw fail("Business record ID mismatch.", "dependency_unavailable");
    return r.item as Row;
  }
  private async scoped(
    p: Principal,
    entity: c.BusinessEntity,
    id: number,
  ): Promise<Row> {
    const row = await this.raw(p, entity, id);
    if (!row) throw absent();
    if (companyField.has(entity)) {
      if (
        typeof row.companyID !== "number" ||
        !Number.isSafeInteger(row.companyID) ||
        row.companyID < 0
      )
        throw absent();
      assertCompanyScope(p, row.companyID);
    }
    if (entity === "PurchaseOrders") {
      if (
        typeof row.purchaseForCompanyID !== "number" ||
        !Number.isSafeInteger(row.purchaseForCompanyID) ||
        row.purchaseForCompanyID < 0
      )
        throw absent();
      assertCompanyScope(p, row.purchaseForCompanyID);
    }
    if (entity === "Projects") assertCompanyScope(p, row.companyID);
    if (entity === "Phases" || entity === "Tasks") {
      const projectId = row.projectID;
      if (!positiveId(projectId)) throw absent();
      const project = await this.scoped(p, "Projects", projectId);
      assertCompanyScope(p, project.companyID);
    }
    if (entity === "ProjectNotes") {
      if (!positiveId(row.projectID)) throw absent();
      const project = await this.scoped(p, "Projects", row.projectID);
      assertCompanyScope(p, project.companyID);
    }
    if (entity === "TaskNotes") {
      if (!positiveId(row.taskID)) throw absent();
      const task = await this.scoped(p, "Tasks", row.taskID);
      const project = await this.scoped(p, "Projects", task.projectID);
      assertCompanyScope(p, project.companyID);
    }
    if (entity === "TaskPredecessors") {
      for (const k of ["successorTaskID", "predecessorTaskID"]) {
        if (!positiveId(row[k])) throw absent();
        await this.scoped(p, "Tasks", row[k]);
      }
    }
    if (entity.startsWith("Contract") && entity !== "Contracts") {
      if (!positiveId(row.contractID)) throw absent();
      const contract = await this.scoped(p, "Contracts", row.contractID);
      assertCompanyScope(p, contract.companyID);
    }
    if (entity === "ConfigurationItemDnsRecords") {
      if (!positiveId(row.installedProductID)) throw absent();
      await this.scoped(p, "ConfigurationItems", row.installedProductID);
    }
    if (entity === "ConfigurationItemNotes" || entity === "Subscriptions") {
      if (!positiveId(row.configurationItemID)) throw absent();
      await this.scoped(p, "ConfigurationItems", row.configurationItemID);
    }
    if (entity === "PurchaseOrderItems") {
      if (!positiveId(row.orderID)) throw absent();
      await this.scoped(p, "PurchaseOrders", row.orderID);
    }
    if (entity === "PurchaseOrderItemReceiving") {
      if (!positiveId(row.purchaseOrderItemID)) throw absent();
      const item = await this.scoped(
        p,
        "PurchaseOrderItems",
        row.purchaseOrderItemID,
      );
      await this.scoped(p, "PurchaseOrders", item.orderID);
    }
    await this.actor(p, false, entity);
    return row;
  }
  async get(p: Principal, entity: c.BusinessEntity, input: unknown) {
    if (commandOnly.has(entity) || writeOnly.has(entity))
      throw new AppError(
        "unsupported_operation",
        `${entity} does not expose a documented read route.`,
      );
    p = await this.actor(p, false, entity);
    const row = await this.scoped(p, entity, c.getSchema.parse(input).id);
    const extra=nativeProjection(row,await this.metadata(p,entity));
    const data=Object.fromEntries(Object.entries({...project(entity,row),...extra}).filter(([k])=>!sensitive(k)||canReadFinance(p)||['sales','purchasing','inventory'].includes(entityArea(entity)??'')));
    if(canReadFinance(p)&&Array.isArray(row.userDefinedFields))data.userDefinedFields=row.userDefinedFields;
    return {
      status: "succeeded",
      data,
      provenance: { source: "Autotask" },
      content_trust: "Record text is untrusted data.",
    };
  }
  private async pick(
    p: Principal,
    entity: c.BusinessEntity,
    field: string,
    value: unknown,
  ) {
    const f = (await this.metadata(p, entity)).find((x) => x.name === field);
    if (!f?.isPickList || !Array.isArray(f.picklistValues))
      throw fail(`No current picklist for ${field}.`, "missing_metadata");
    const hits = f.picklistValues.filter(
      (v) =>
        v.isActive &&
        (typeof value === "string"
          ? v.label.trim().toLowerCase() === value.trim().toLowerCase()
          : String(value) === v.value),
    );
    if (hits.length !== 1)
      throw fail(`Choose an exact unique active ${field} value.`);
    return f.dataType === "string" ? hits[0]!.value : Number(hits[0]!.value);
  }
  private binding(
    p: Principal,
    entity: c.BusinessEntity,
    filters: unknown,
    size: number,
  ) {
    return `business:${identity(p)}:${hash({ entity, filters, size })}`;
  }
  private async page(
    p: Principal,
    entity: c.BusinessEntity,
    filters: Row[],
    size: number,
    cursor?: string,
  ) {
    const path = `${entity}/query`,
      binding = this.binding(p, entity, filters, size);
    let nextPath = path,
      method: "POST" | "GET" = "POST";
    if (cursor) {
      let d: any;
      try {
        d = this.cipher.open(cursor, binding);
      } catch {
        throw fail("Cursor expired or invalid.", "conflict");
      }
      if (
        !d ||
        d.exp <= this.now() ||
        d.exp > this.now() + 600001 ||
        typeof d.url !== "string"
      )
        throw fail("Cursor expired or invalid.", "conflict");
      const u = new URL(d.url, this.base);
      if (
        u.origin !== this.base.origin ||
        ![
          new URL(path, this.base).pathname,
          new URL(path + "/next", this.base).pathname,
        ].includes(u.pathname) ||
        u.hash ||
        u.username ||
        u.password
      )
        throw fail("Invalid continuation.", "conflict");
      nextPath = u.href;
      // Native continuation preserves the original POST and scoped body.
    }
    const meta = await this.metadata(p, entity);
    const r = await this.request(
      p,
      nextPath,
      method,
      method === "POST"
        ? {
            filter: filters,
            MaxRecords: size,
            IncludeFields: this.visible(p, entity).filter((k) =>
              meta.some((f) => f.name === k),
            ),
          }
        : undefined,
      false,
      false,
      entity,
    );
    if (
      !Array.isArray(r.items) ||
      r.items.length > size ||
      r.items.some((v: any) => !positiveId(v.id))
    )
      throw fail("Invalid business page.", "dependency_unavailable");
    let next: string | null = null;
    if (r.pageDetails?.nextPageUrl) {
      const u = new URL(r.pageDetails.nextPageUrl, this.base);
      if (
        u.origin !== this.base.origin ||
        ![
          new URL(path, this.base).pathname,
          new URL(path + "/next", this.base).pathname,
        ].includes(u.pathname) ||
        u.hash ||
        u.username ||
        u.password
      )
        throw fail("Unsafe business continuation.", "dependency_unavailable");
      next = this.cipher.seal(
        { url: u.href, exp: this.now() + 600000 },
        binding,
      );
    }
    return { items: r.items as Row[], next };
  }
  async search(p: Principal, entity: c.BusinessEntity, input: unknown) {
    if (writeOnly.has(entity))
      throw new AppError(
        "unsupported_operation",
        `${entity} does not expose a documented read route.`,
      );
    p = await this.actor(p, false, entity);
    if(!c.searchSchemaFor(entity).safeParse(input).success)throw fail(`Invalid search filters for ${entity}; use the advertised search schema.`);
    const a = (entity === "CompanyToDos" ? c.todoSearchSchema : c.searchSchema).parse(input),
      filters: Row[] = [];
    const companyId =
      a.company === undefined ? undefined : await this.company(p, a.company);
    const directCompany =
      companyField.has(entity) || entity === "PurchaseOrders";
    if (directCompany)
      filters.push({
        field: companyFilterField(entity),
        op: "in",
        value: companyId === undefined ? p.companyIds : [companyId],
      });
    const parent = c.searchParentFilters(entity);
    const needsParent = parentField[entity];
    const key = Object.keys(parent).find((k) => parent[k]![0] === needsParent);
    if (needsParent && (!key || (a as Row)[key] === undefined))
      throw fail(`${entity} requires ${key ?? needsParent}.`);
    if (companyId !== undefined && !directCompany && !needsParent)
      throw fail("This tenant catalog entity does not have a company filter.");
    const parents: Array<{ field: string; entity: string; id: number }> = [];
    for (const [k, [field, parentEntity]] of Object.entries(parent)) {
      const id = (a as Row)[k];
      if (id === undefined) continue;
      if (c.searchIdAlias[entity] === k) {
        filters.push({field:"id",op:"eq",value:id});
        continue;
      }
      if (!c.fields[entity].includes(field))
        throw fail(`Filter ${k} is unsupported for ${entity}.`);
      if (parentEntity === "InventoryLocations")
        await this.catalogRecord(p, parentEntity, id);
      else {
        const row = await this.scoped(p, parentEntity as c.BusinessEntity, id);
        const scope = await this.companyOf(
          p,
          parentEntity as c.BusinessEntity,
          row,
        );
        if (companyId !== undefined && scope !== companyId) throw absent();
      }
      parents.push({ field, entity: parentEntity, id });
      filters.push({ field, op: "eq", value: id });
    }
    if(entity === "CompanyToDos") {
      const todo = c.todoSearchSchema.parse(input);
      if(todo.owner !== undefined) filters.push({field:'assignedToResourceID',op:'eq',value:todo.owner === 'self' ? p.resourceId : todo.owner});
      if(todo.completion !== 'all') filters.push({field:'completedDate',op:todo.completion === 'open' ? 'notExist' : 'exist'});
    }
    if (a.text)
      filters.push({
        field: c.searchTextField[entity]!,
        op: "contains",
        value: a.text,
      });
    if (a.status !== undefined) {
      const f = (await this.metadata(p, entity)).find(
        (x) => x.name === "status" || x.name === "invoiceStatus" || x.name === "statusID",
      );
      if (!f) throw fail("Status filter unsupported.");
      filters.push({
        field: f.name,
        op: "eq",
        value: f.isPickList
          ? await this.pick(p, entity, f.name, a.status)
          : a.status,
      });
    }
    if (!filters.length) filters.push({ field: "id", op: "gte", value: 0 });
    const meta = await this.metadata(p, entity);
    for (const f of filters)
      if (!meta.some((x) => x.name === f.field && x.isQueryable))
        throw fail(`Field ${f.field} cannot be queried.`, "missing_metadata");
    const result = await this.page(p, entity, filters, a.page_size, a.cursor);
    if (new Set(result.items.map((r) => r.id)).size !== result.items.length)
      throw fail("Duplicate business records.", "dependency_unavailable");
    for (const row of result.items) {
      if (directCompany) assertCompanyScope(p, row[companyFilterField(entity)]);
      for (const f of filters)
        if (
          (f.op === "exist" && row[f.field] == null) ||
          (f.op === "notExist" && row[f.field] != null) ||
          (f.op === "eq" && row[f.field] !== f.value) ||
          (f.op === "in" && !f.value.includes(row[f.field])) ||
          (f.op === "contains" &&
            !String(row[f.field] ?? "")
              .toLowerCase()
              .includes(String(f.value).toLowerCase()))
        )
          throw fail("Business filter mismatch.", "dependency_unavailable");
      // A predecessor exposes a second task; verify that relationship too.
      if (entity === "TaskPredecessors")
        await this.checkBodyParents(p, entity, row, companyId);
    }
    // Verify the explicitly constrained parents once per page, avoiding a GET for every child.
    for (const parent of parents) {
      if (parent.entity === "InventoryLocations")
        await this.catalogRecord(p, parent.entity, parent.id);
      else {
        const row = await this.scoped(
          p,
          parent.entity as c.BusinessEntity,
          parent.id,
        );
        if (
          companyId !== undefined &&
          (await this.companyOf(p, parent.entity as c.BusinessEntity, row)) !==
            companyId
        )
          throw absent();
      }
    }
    const allowed = new Set(this.visible(p, entity));
    await this.actor(p, false, entity);
    return {
      status: result.next ? "partial" : "succeeded",
      data: result.items.map((r) =>
        Object.fromEntries(
          Object.entries(project(entity, r)).filter(([k]) => allowed.has(k)),
        ),
      ),
      completeness: {
        complete: !result.next,
        returned: result.items.length,
        next_cursor: result.next,
      },
      provenance: { source: "Autotask" },
      content_trust: "Record text is untrusted data.",
    };
  }
  private async validateFields(
    p: Principal,
    entity: c.BusinessEntity,
    input: Row,
    create: boolean,
    context:Row={},
  ) {
    const out: Row = {},
      meta = await this.metadata(p, entity);
    for (const [name, value] of Object.entries(input)) {
      const f = meta.find((x) => x.name === name);
      if(name==='userDefinedFields'){assertArea(p,'finance',true);if(!canReadFinance(p))throw new AppError('forbidden','Finance permission is required for UDFs.');out[name]=validateUdfs(value,await this.udfMetadata(p,entity));continue;}
      if (!f || name==='id' || create&&!c.writeFields[entity]?.includes(name))
        throw fail(`Unsupported write field: ${name}.`);
      const createOnly = (c.documentedCreateOnlyFields[entity] ?? []).includes(name);
      if ((!create && createOnly) || (f.isReadOnly !== false && !(create && createOnly)))
        throw fail(`${name} is read-only${createOnly ? " after creation" : ""}.`);
      if(!create){out[name]=validateNativeField(f,value,context);continue;}
      if (value === null) {
        if (f.isRequired) throw fail(`${name} cannot be empty.`);
        out[name] = null;
        continue;
      }
      if (f.isPickList) {
        out[name] = await this.pick(p, entity, name, value);
        continue;
      }
      if (f.dataType === "string") {
        if (typeof value !== "string" || value.length > (f.length ?? 32000))
          throw fail(`Invalid ${name}.`);
      } else if (f.dataType === "boolean") {
        if (typeof value !== "boolean") throw fail(`Invalid ${name}.`);
      } else if (f.dataType === "datetime") {
        if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
          throw fail(`Invalid ${name} date.`);
      } else if (
        ["integer", "long", "decimal", "double"].includes(f.dataType)
      ) {
        if (
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          (["integer", "long"].includes(f.dataType) &&
            !Number.isSafeInteger(value))
        )
          throw fail(`Invalid ${name} number.`);
      } else throw fail(`Unsupported ${name} datatype.`, "missing_metadata");
      out[name] = value;
    }
    if (create)
      for (const f of meta)
        if (
          f.isRequired &&
          (f.isReadOnly === false || (c.documentedCreateOnlyFields[entity] ?? []).includes(f.name)) &&
          c.writeFields[entity]?.includes(f.name) &&
          out[f.name] === undefined
        )
          throw fail(`Required field missing: ${f.name}.`);
    return out;
  }
  private async resolveParent(
    p: Principal,
    entity: c.BusinessEntity,
    a: any,
    body: Row,
  ) {
    let companyId: number | undefined;
    const parent = parentField[entity];
    if (
      a.company !== undefined &&
      !companyField.has(entity) &&
      entity !== "PurchaseOrders"
    ) {
      if (!parent)
        throw fail("This tenant catalog entity does not have company scope.");
      companyId = await this.company(p, a.company);
    }
    if (companyField.has(entity) || entity === "PurchaseOrders") {
      if (
        a.company === undefined &&
        body.companyID === undefined &&
        body.purchaseForCompanyID === undefined
      )
        throw fail("Company is required.");
      companyId =
        a.company !== undefined
          ? await this.company(p, a.company)
          : (body.companyID ?? body.purchaseForCompanyID);
      if (
        body[companyFilterField(entity)] !== undefined &&
        body[companyFilterField(entity)] !== companyId
      )
        throw fail("Company argument conflicts with native company field.");
      assertCompanyScope(p, companyId);
      if (entity === "PurchaseOrders") body.purchaseForCompanyID = companyId;
      else body.companyID = companyId;
    }
    const supplied: any = {
      contractID: a.contract_id,
      projectID: a.project_id,
      phaseID: a.phase_id,
      ...(entity === "TaskNotes" ? { taskID: a.task_id } : { successorTaskID: a.task_id }),
      orderID: a.purchase_order_id,
      purchaseOrderItemID: a.purchase_order_item_id,
      configurationItemID: a.configuration_item_id,
    };
    if (entity === "ConfigurationItemDnsRecords") {
      delete supplied.configurationItemID;
      supplied.installedProductID = a.configuration_item_id;
    }
    const argumentFor: any = {
      contractID: "contract_id",
      projectID: "project_id",
      phaseID: "phase_id",
      successorTaskID: "task_id",
      taskID: "task_id",
      orderID: "purchase_order_id",
      purchaseOrderItemID: "purchase_order_item_id",
      configurationItemID: "configuration_item_id",
      installedProductID: "configuration_item_id",
    };
    const pe: any = {
      contractID: "Contracts",
      projectID: "Projects",
      phaseID: "Phases",
      successorTaskID: "Tasks",
      taskID: "Tasks",
      orderID: "PurchaseOrders",
      purchaseOrderItemID: "PurchaseOrderItems",
      configurationItemID: "ConfigurationItems",
      installedProductID: "ConfigurationItems",
    };
    if (parent && body[parent] !== undefined && supplied[parent] === undefined)
      throw fail(
        `Supply ${argumentFor[parent]} rather than an unscoped parent field.`,
      );
    for (const [field, id] of Object.entries(supplied)) {
      if (id === undefined) continue;
      if (!c.writeFields[entity]?.includes(field))
        throw fail(
          `Parent argument ${argumentFor[field]} is unsupported for ${entity}.`,
        );
      const parentRow = await this.scoped(
        p,
        pe[field] as c.BusinessEntity,
        id as number,
      );
      if (body[field] !== undefined && body[field] !== id)
        throw fail(`Supplied parent conflicts with ${field}.`);
      body[field] = id;
      const parentCompany = await this.companyOf(
        p,
        pe[field] as c.BusinessEntity,
        parentRow,
      );
      if (
        companyId !== undefined &&
        parentCompany !== undefined &&
        companyId !== parentCompany
      )
        throw absent();
      if (companyId === undefined) companyId = parentCompany;
    }
    if (writeOnly.has(entity) && commandOnly.has(entity)) {
      if (!positiveId(body.inventoryProductID))
        throw fail("Inventory product is required for stocked-item commands.");
      await this.scoped(p, "InventoryProducts", body.inventoryProductID);
    }
    if (parent && body[parent] === undefined)
      throw fail(`Parent ${parent} is required.`);
    if (
      entity === "Tasks" &&
      body.phaseID !== undefined &&
      body.projectID !== undefined
    ) {
      const phase = await this.scoped(p, "Phases", body.phaseID);
      if (phase.projectID !== body.projectID)
        throw fail("Phase belongs to another project.");
    }
    return companyId;
  }
  private async companyOf(
    p: Principal,
    entity: c.BusinessEntity,
    row: Row,
  ): Promise<number | undefined> {
    if (typeof row.companyID === "number") return row.companyID as number;
    if (
      entity === "PurchaseOrders" &&
      typeof row.purchaseForCompanyID === "number"
    )
      return row.purchaseForCompanyID as number;
    if (entity === "Phases" || entity === "Tasks") {
      const parent = await this.scoped(p, "Projects", row.projectID);
      return parent.companyID as number;
    }
    if (entity === "ProjectNotes") {
      const parent = await this.scoped(p, "Projects", row.projectID);
      return parent.companyID as number;
    }
    if (entity === "TaskNotes") {
      const task = await this.scoped(p, "Tasks", row.taskID);
      const parent = await this.scoped(p, "Projects", task.projectID);
      return parent.companyID as number;
    }
    if (entity.startsWith("Contract") && entity !== "Contracts") {
      const parent = await this.scoped(p, "Contracts", row.contractID);
      return parent.companyID as number;
    }
    if (entity === "TaskPredecessors") {
      const task = await this.scoped(p, "Tasks", row.successorTaskID);
      return this.companyOf(p, "Tasks", task);
    }
    if (entity === "ConfigurationItemDnsRecords") {
      const item = await this.scoped(
        p,
        "ConfigurationItems",
        row.installedProductID,
      );
      return item.companyID as number;
    }
    if (entity === "ConfigurationItemNotes" || entity === "Subscriptions") {
      const item = await this.scoped(
        p,
        "ConfigurationItems",
        row.configurationItemID,
      );
      return item.companyID as number;
    }
    if (entity === "PurchaseOrderItems") {
      const po = await this.scoped(p, "PurchaseOrders", row.orderID);
      return this.companyOf(p, "PurchaseOrders", po);
    }
    if (entity === "PurchaseOrderItemReceiving") {
      const item = await this.scoped(
        p,
        "PurchaseOrderItems",
        row.purchaseOrderItemID,
      );
      return this.companyOf(p, "PurchaseOrderItems", item);
    }
    return undefined;
  }
  private async catalogRecord(
    p: Principal,
    entity: string,
    id: number,
  ): Promise<Row> {
    const allowed = [
      "InventoryLocations",
      "ContractServiceBundles",
      "Contacts",
      "CompanyLocations",
      "Opportunities",
      "QuoteItems",
      "Quotes",
      "Services",
      "ServiceBundles",
      "BillingCodes",
      "Resources",
      "Roles",
      "ResourceRoles",
    ];
    if (!allowed.includes(entity) || !positiveId(id))
      throw fail("Invalid related record.");
    const value = await this.request(
      p,
      `${entity}/${id}`,
      "GET",
      undefined,
      false,
      false,
      "Products",
    );
    if (!value?.item || value.item.id !== id) throw absent();
    return value.item;
  }
  private async checkBodyParents(
    p: Principal,
    entity: c.BusinessEntity,
    body: Row,
    companyId: number | undefined,
  ) {
    const map: Record<string, c.BusinessEntity> = {
      contractID: "Contracts",
      projectID: "Projects",
      taskID: "Tasks",
      phaseID: "Phases",
      parentPhaseID: "Phases",
      successorTaskID: "Tasks",
      predecessorTaskID: "Tasks",
      configurationItemID: "ConfigurationItems",
      parentConfigurationItemID: "ConfigurationItems",
      installedProductID: "ConfigurationItems",
      orderID: "PurchaseOrders",
      purchaseOrderItemID: "PurchaseOrderItems",
      contractServiceID: "ContractServices",
      productID: "Products",
      inventoryProductID: "InventoryProducts",
      inventoryStockedItemID: "InventoryStockedItems",
    };
    const parents: Record<string, Row> = {};
    for (const [field, parentEntity] of Object.entries(map)) {
      if (body[field] === undefined || body[field] === null) continue;
      const parent = await this.scoped(p, parentEntity, body[field]);
      parents[field] = parent;
      const scope = await this.companyOf(p, parentEntity, parent);
      if (companyId !== undefined && scope !== undefined && companyId !== scope)
        throw absent();
    }
    for (const field of ["phaseID", "parentPhaseID"])
      if (parents[field] && parents[field]!.projectID !== body.projectID)
        throw fail("Phase belongs to another project.");
    if (
      entity === "TaskPredecessors" &&
      (body.successorTaskID === body.predecessorTaskID ||
        parents.successorTaskID?.projectID !==
          parents.predecessorTaskID?.projectID)
    )
      throw fail("Dependencies require distinct tasks in the same project.");
    if (
      parents.contractServiceID &&
      parents.contractServiceID.contractID !== body.contractID
    )
      throw fail("Contract service belongs to another contract.");
    if (
      parents.inventoryStockedItemID &&
      parents.inventoryStockedItemID.inventoryProductID !==
        body.inventoryProductID
    )
      throw fail("Stocked item belongs to another inventory product.");
    if (
      entity === "Phases" &&
      body.id !== undefined &&
      body.parentPhaseID === body.id
    )
      throw fail("A phase cannot be its own parent.");
    if (
      entity === "ConfigurationItems" &&
      body.id !== undefined &&
      body.parentConfigurationItemID === body.id
    )
      throw fail("An asset cannot be its own parent.");
    for (const field of [
      "assignedToResourceID",
      "assignedResourceID",
      "projectLeadResourceID",
      "receivedByResourceID",
      "transferByResourceID",
    ])
      if (body[field] !== undefined && body[field] !== null) {
        const resource = await this.catalogRecord(p, "Resources", body[field]);
        if (resource.isActive !== true)
          throw fail("The selected employee is not active.");
      }
    for (const field of [
      "inventoryLocationID",
      "newInventoryLocationID",
      "fromLocationID",
      "toLocationID",
    ])
      if (body[field] !== undefined && body[field] !== null)
        await this.catalogRecord(p, "InventoryLocations", body[field]);
    if (
      entity === "InventoryStockedItemsTransfer" &&
      parents.inventoryProductID?.inventoryLocationID ===
        body.newInventoryLocationID
    )
      throw fail("Inventory transfer source and destination must differ.");
    for (const field of ["vendorID", "defaultVendorID", "billToCompanyID"])
      if (body[field] !== undefined && body[field] !== null)
        await this.company(p, body[field]);
    for (const field of [
      "contactID",
      "installedByContactID",
      "billToCompanyContactID",
      "companyLocationID",
      "opportunityID",
    ]) {
      if (body[field] === undefined || body[field] === null) continue;
      const native =
        field === "opportunityID"
          ? "Opportunities"
          : field === "companyLocationID"
            ? "CompanyLocations"
            : "Contacts";
      const related = await this.catalogRecord(p, native, body[field]);
      const expectedCompany =
        field === "billToCompanyContactID"
          ? (body.billToCompanyID ?? companyId)
          : companyId;
      if (
        expectedCompany === undefined ||
        related.companyID !== expectedCompany
      )
        throw absent();
      assertCompanyScope(p, related.companyID);
      if(entity === "CompanyToDos" && field === "contactID" && related.isActive !== true) throw absent();
    }
    if (body.ticketID !== undefined && body.ticketID !== null) {
      const ticket = await this.core.adapter.get(p, "Tickets", body.ticketID);
      assertCompanyScope(p, ticket.companyID as number);
      if (companyId === undefined || ticket.companyID !== companyId)
        throw absent();
    }
    if (
      body.contractServiceBundleID !== undefined &&
      body.contractServiceBundleID !== null
    ) {
      const bundle = await this.catalogRecord(
        p,
        "ContractServiceBundles",
        body.contractServiceBundleID,
      );
      if (bundle.contractID !== body.contractID) throw absent();
      await this.scoped(p, "Contracts", bundle.contractID);
    }
    if (body.quoteItemID !== undefined && body.quoteItemID !== null) {
      const item = await this.catalogRecord(p, "QuoteItems", body.quoteItemID);
      const quote = await this.catalogRecord(p, "Quotes", item.quoteID);
      if (companyId === undefined || quote.companyID !== companyId)
        throw absent();
      assertCompanyScope(p, quote.companyID);
    }
  }
  private async verifyPersonInputs(p:Principal, fields:Row, identities:Row={}) {
    const contacts=['contactID','installedByContactID','billToCompanyContactID'];
    const employees=['assignedToResourceID','assignedResourceID','companyOwnerResourceID','projectLeadResourceID','receivedByResourceID','transferByResourceID','installedByID'];
    const supported=[...contacts,...employees];
    for(const field of Object.keys(identities))if(!supported.includes(field)||fields[field]==null)throw fail('Person identity must accompany a supported explicit person field.');
    for(const field of supported){
      if(fields[field]==null)continue;
      if(!identities[field])assertPersonIdentity(undefined,{},field);
      const person=await this.catalogRecord(p,contacts.includes(field)?'Contacts':'Resources',fields[field]);
      if(person.isActive!==true&&person.isActive!==1)throw fail('The intended person must be active.');
      assertPersonIdentity(identities[field],{name:`${person.firstName??''} ${person.lastName??''}`.trim(),email:person.emailAddress},field);
    }
    // Authorship and completion identity are not assignment fields. Never let caller IDs impersonate them.
    for(const field of Object.keys(fields))if(/(?:ResourceID|ContactID|PersonID)$/.test(field)&&!supported.includes(field)&&fields[field]!=null)throw fail(`Caller-supplied person attribution ${field} is unsupported.`);
  }
  private async preflightWrite(
    p: Principal,
    entity: c.BusinessEntity,
    body: Row,
    companyId: number | undefined,
    before: Row | undefined,
    id: number | undefined,
    expected: Row,
    personInput?: {fields:Row;identities:Row},
  ) {
    await this.checkBodyParents(p, entity, { ...before, ...body }, companyId);
    if(personInput)await this.verifyPersonInputs(p,personInput.fields,personInput.identities);
    if (before && id !== undefined) {
      const fresh = await this.scoped(p, entity, id);
      const freshCompany = await this.companyOf(p, entity, fresh);
      if (companyId !== freshCompany)
        throw fail("Record scope changed before dispatch.", "conflict");
      for (const k of Object.keys(expected))
        if (!fieldMatches(k,fresh[k],expected[k]))
          throw fail("Record changed before dispatch.", "conflict");
    }
  }
  private writeCapability(entity: c.BusinessEntity) {
    return entity === "CompanyToDos" ? "sales.write" : financeEntities.has(entity)
      ? "finance.write"
      : projectEntities.has(entity)
        ? "projects.write"
        : procurementEntities.has(entity)
          ? "procurement.write"
          : "configuration.write";
  }
  private writeRoute(
    entity: c.BusinessEntity,
    action: "create" | "update" | "delete",
    body: Row,
    id: number | undefined,
    before?: Row,
  ) {
    const value = (field: string) => body[field] ?? before?.[field];
    if (entity === "CompanyToDos") return `Companies/${value("companyID")}/ToDos${action === "delete" ? `/${id}` : ""}`;
    if (entity === "ProjectNotes") return `Projects/${value("projectID")}/Notes`;
    if (entity === "TaskNotes") return `Tasks/${value("taskID")}/Notes`;
    if (entity === "ContractServices")
      return `Contracts/${value("contractID")}/Services`;
    if (entity === "ContractBlocks")
      return `Contracts/${value("contractID")}/Blocks`;
    if (entity === "ContractCharges")
      return `Contracts/${value("contractID")}/Charges${action === "delete" ? `/${id}` : ""}`;
    if (entity === "ContractServiceAdjustments")
      return `Contracts/${value("contractID")}/ServiceAdjustments`;
    if (entity === "ContractServiceBundleAdjustments")
      return `Contracts/${value("contractID")}/ServiceBundleAdjustments`;
    if (entity === "Phases") return `Projects/${value("projectID")}/Phases`;
    if (entity === "Tasks") return `Projects/${value("projectID")}/Tasks`;
    if (entity === "TaskPredecessors")
      return `Tasks/${value("successorTaskID")}/Predecessors${action === "delete" ? `/${id}` : ""}`;
    if (entity === "ConfigurationItemDnsRecords")
      return `ConfigurationItems/${value("installedProductID")}/DnsRecords/${id}`;
    if (entity === "ConfigurationItemNotes")
      return `ConfigurationItems/${value("configurationItemID")}/Notes`;
    if (commandOnly.has(entity))
      return `InventoryProducts/${value("inventoryProductID")}/StockedItems${entity === "InventoryStockedItemsAdd" ? "Add" : entity === "InventoryStockedItemsRemove" ? "Remove" : "Transfer"}`;
    if (entity === "PurchaseOrderItems")
      return `PurchaseOrders/${value("orderID")}/Items`;
    if (entity === "PurchaseOrderItemReceiving")
      return `PurchaseOrderItems/${value("purchaseOrderItemID")}/Receiving`;
    return entity + (action === "delete" ? `/${id}` : "");
  }
  private async receipt(p: Principal, r: JournalRecord) {
    const entity=c.businessEntities.find(e=>r.operation.startsWith(`business_${e.toLowerCase()}_`));
    if(!entity) throw absent();
    assertEntityArea(p,entity);
    await this.actor(p);
    if (
      r.actorKey !== actorKey(p) ||
      r.mappingVersion !== p.mappingVersion ||
      r.resourceId !== p.resourceId ||
      r.policyVersion !== p.policyVersion
    )
      throw absent();
    if (typeof r.result?.company_id === "number")
      assertCompanyScope(p, r.result.company_id);
    return {
      status: r.state,
      operation_id: r.id,
      ...r.result,
      can_automatically_retry: false,
    };
  }
  async write(
    p: Principal,
    entity: c.BusinessEntity,
    action: "create" | "update" | "delete",
    input: unknown,
  ) {
    p = await this.actor(p, true, entity);
    if (!c.documentedWrites[entity]?.includes(action))
      throw new AppError(
        "unsupported_operation",
        `${action} is not documented for ${entity}.`,
      );
    const a: any =
      action === "create"
        ? c.createSchema.parse(input)
        : action === "update"
          ? c.updateSchema.parse(input)
          : c.deleteSchema.parse(input);
    if (['projects','configuration'].includes(entityArea(entity)??'')) {
      if (Object.keys(a.fields??{}).some(sensitive)) assertArea(p,'finance',true);
      if (Object.keys(a.expected??{}).some(sensitive)) assertArea(p,'finance');
    }
    if(Object.hasOwn(a.fields??{},'userDefinedFields')||Object.hasOwn(a.expected??{},'userDefinedFields')){assertArea(p,'finance',Object.hasOwn(a.fields??{},'userDefinedFields'));if(!canReadFinance(p))throw new AppError('forbidden','Finance permission is required for UDFs.');}
    const operation = `business_${entity.toLowerCase()}_${action}`,
      digest = hash({ operation, input: a, identity: identity(p) }),
      prior = await this.core.journal.find(actorKey(p), a.request_key);
    if (prior) {
      if (prior.payloadHash !== digest || prior.operation !== operation)
        throw fail("Request key belongs to different work.", "conflict");
      return this.receipt(p, prior);
    }
    let before: Row | undefined,
      body: Row = structuredClone(a.fields ?? {}),
      companyId: number | undefined;
    if (action !== "create") {
      before = await this.scoped(p, entity, a.id);
      companyId = await this.companyOf(p, entity, before);
      if(action==='update'&&Array.isArray(body.userDefinedFields)&&body.userDefinedFields.some((v:Row)=>!Array.isArray(a.expected.userDefinedFields)||!a.expected.userDefinedFields.some((e:Row)=>e.name===v.name)))throw fail('Supply expected values for every changed UDF.');
      for (const k of Object.keys(a.expected))
        if (
          !(k==='userDefinedFields'||(await this.metadata(p,entity)).some(f=>f.name===k)) ||
          !fieldMatches(k,before[k],a.expected[k])
        )
          throw fail(
            "Record changed or expected field is invalid. Refresh before updating.",
            "conflict",
          );
      if (
        action === "update" &&
        Object.keys(body).some((k) => !Object.hasOwn(a.expected, k))
      )
        throw fail("Supply expected value for every changed field.");
    } else companyId = await this.resolveParent(p, entity, a, body);
    if(entity === "CompanyToDos") {
      const merged = {...before,...body};
      if(action !== 'delete' && merged.startDateTime && merged.endDateTime && Date.parse(merged.endDateTime) < Date.parse(merged.startDateTime)) throw fail('To-do end precedes start.');
      if(action === 'delete' && ['companyID','activityDescription','assignedToResourceID','startDateTime','endDateTime','completedDate'].some(k=>!Object.hasOwn(a.expected,k))) throw fail('To-do deletion requires expected companyID, activityDescription, assignedToResourceID, startDateTime, endDateTime and completedDate.');
    }
    if (
      entity === "TaskPredecessors" &&
      action !== "delete" &&
      body.successorTaskID !== undefined &&
      body.successorTaskID === body.predecessorTaskID
    )
      throw fail("A task cannot depend on itself.");
    if (
      entity === "TaskPredecessors" &&
      action === "update" &&
      Object.keys(body).some((k) => k !== "lagDays")
    )
      throw fail("Task predecessors permit lagDays updates only.");
    if (
      entity === "Tasks" &&
      body.startDateTime &&
      body.endDateTime &&
      Date.parse(body.endDateTime) < Date.parse(body.startDateTime)
    )
      throw fail("Task end precedes start.");
    if (
      entity === "Phases" &&
      body.startDate &&
      body.endDate &&
      Date.parse(body.endDate) < Date.parse(body.startDate)
    )
      throw fail("Phase end precedes start.");
    if (
      entity === "InventoryStockedItemsTransfer" &&
      body.currentInventoryLocationID !== undefined &&
      body.newInventoryLocationID !== undefined &&
      body.currentInventoryLocationID === body.newInventoryLocationID
    )
      throw fail("Inventory transfer source and destination must differ.");
    if (
      entity === "InventoryTransfers" &&
      body.fromLocationID !== undefined &&
      body.toLocationID !== undefined &&
      body.fromLocationID === body.toLocationID
    )
      throw fail("Inventory transfer source and destination must differ.");
    if (
      [
        "InventoryStockedItemsAdd",
        "InventoryStockedItemsRemove",
        "InventoryStockedItemsTransfer",
      ].includes(entity) &&
      (!Number.isFinite(
        body[
          entity === "InventoryStockedItemsAdd"
            ? "quantityBeingAdded"
            : entity === "InventoryStockedItemsRemove"
              ? "quantityBeingRemoved"
              : "quantityBeingTransferred"
        ],
      ) ||
        body[
          entity === "InventoryStockedItemsAdd"
            ? "quantityBeingAdded"
            : entity === "InventoryStockedItemsRemove"
              ? "quantityBeingRemoved"
              : "quantityBeingTransferred"
        ] <= 0)
    )
      throw fail("Quantity must be positive.");
    if (
      entity === "InventoryTransfers" &&
      body.quantityTransferred !== undefined &&
      body.quantityTransferred <= 0
    )
      throw fail("Quantity must be positive.");
    if (
      entity === "PurchaseOrderItemReceiving" &&
      body.quantityNowReceiving !== undefined &&
      body.quantityNowReceiving <= 0
    )
      throw fail("Quantity must be positive.");
    body =
      action === "delete"
        ? body
        : await this.validateFields(p, entity, body, action === "create",{...before,...body});
    if (companyId === undefined && body.companyID !== undefined)
      companyId = body.companyID;
    if (
      entity === "Tasks" &&
      positiveId(body.phaseID) &&
      positiveId(body.projectID)
    ) {
      const phase = await this.scoped(p, "Phases", body.phaseID);
      if (phase.projectID !== body.projectID)
        throw fail("Phase belongs to another project.");
    }
    const route = this.writeRoute(entity, action, body, a.id, before);
    if (action === "update") body.id = a.id;
    const intent = {
      entity,
      action,
      body,
      expected: a.expected,
      id: a.id,
      companyId,
      route,
    };
    const resultBase = {
      ...(companyId !== undefined ? { company_id: companyId } : {}),
      entity,
      action,
    };
    if(action!=="delete"){await this.checkBodyParents(p,entity,{...before,...body},companyId);await this.verifyPersonInputs(p,a.fields,a.person_identities??{});}
    const reserved = await this.core.journal.reserve({
      actorKey: actorKey(p),
      requestKey: a.request_key,
      payloadHash: digest,
      operation,
      mappingVersion: p.mappingVersion,
      resourceId: p.resourceId,
      policyVersion: p.policyVersion,
      encryptedIntent: this.cipher.seal(
        intent,
        `business-write:${identity(p)}:${a.request_key}:${digest}`,
      ),
      intentExpiresAt: new Date(this.now() + 7 * 86400000).toISOString(),
      result: resultBase,
    });
    if (!reserved.created) return this.receipt(p, reserved.record);
    const record = reserved.record;
    let sent = false,
      nativeId: number | undefined = action === "create" ? undefined : a.id;
    try {
      await this.actor(p, true, entity, body);
      await this.preflightWrite(
        p,
        entity,
        body,
        companyId,
        before,
        a.id,
        a.expected ?? {},
        action==="delete"?undefined:{fields:a.fields,identities:a.person_identities??{}},
      );
      await this.core.journal.transition(record.id, "ready", "dispatching");
      sent = true;
      const response = await this.request(
        p,
        route,
        action === "create" ? "POST" : action === "update" ? "PATCH" : "DELETE",
        action === "delete" ? undefined : body,
        true,
        false,
        entity,
        body,
        () =>
          this.preflightWrite(
            p,
            entity,
            body,
            companyId,
            before,
            a.id,
            a.expected ?? {},
            action==="delete"?undefined:{fields:a.fields,identities:a.person_identities??{}},
          ),
      );
      if (action === "create") {
        nativeId = response.itemId;
        if (!positiveId(nativeId)) {
          nativeId = undefined;
          if (!writeOnly.has(entity))
            throw new AppError(
              "unknown_outcome",
              "Create response has no valid native ID.",
            );
        }
      }
      await this.core.journal.transition(
        record.id,
        "dispatching",
        "accepted_unverified",
        { ...resultBase, ...(nativeId ? { native_id: nativeId } : {}) },
      );
      const saved = (await this.core.journal.get(record.id, actorKey(p)))!;
      return writeOnly.has(entity)
        ? this.receipt(p, saved)
        : withReconciliation(()=>this.verify(p, saved, intent));
    } catch (error) {
      const definite =
        error instanceof AppError &&
        [
          "invalid_input",
          "forbidden",
          "throttled",
          "conflict",
          "identity_mapping_invalid",
          "identity_validation_unavailable",
          "not_found_or_inaccessible",
          "unsupported_operation",
        ].includes(error.code);
      const state = sent && !definite ? "unknown_outcome" : "failed";
      try {
        const current = await this.core.journal.get(record.id, actorKey(p));
        if (
          current &&
          (current.state === "ready" || current.state === "dispatching")
        )
          await this.core.journal.transition(record.id, current.state, state, {
            ...resultBase,
            ...(nativeId ? { native_id: nativeId } : {}),
            error_code:
              error instanceof AppError ? error.code : "dependency_unavailable",
          });
      } catch {}
      return this.receipt(
        p,
        (await this.core.journal.get(record.id, actorKey(p)))!,
      );
    }
  }
  private async verify(p: Principal, r: JournalRecord, intent: any) {
    const nativeId = r.result?.native_id;
    if (!positiveId(nativeId) || writeOnly.has(intent.entity))
      return this.receipt(p, r);
    const row =
      intent.action === "delete"
        ? await this.raw(p, intent.entity, nativeId, true)
        : await this.scoped(p, intent.entity, nativeId);
    if (
      row &&
      intent.companyId !== undefined &&
      row.companyID !== undefined &&
      row.companyID !== intent.companyId
    )
      throw absent();
    const dateFields=new Set(intent.action==="delete"?[]:(await this.metadata(p,intent.entity)).filter(f=>f.dataType==="datetime").map(f=>f.name));
    const matches =
      intent.action === "delete"
        ? row === undefined
        : Object.entries(intent.body)
            .filter(([k]) => k !== "id")
            .every(([k, v]) => dateFields.has(k)&&typeof v==="string"&&typeof row?.[k]==="string"?Date.parse(row[k])===Date.parse(v):fieldMatches(k,row?.[k],v));
    if (!matches)
      return {
        ...(await this.receipt(p, r)),
        verification:
          "Saved fields did not match or readback was incomplete. Inspect before further changes.",
      };
    const saved = await this.core.journal.transition(
      r.id,
      r.state,
      "succeeded_verified",
      { ...r.result, verified: true },
    );
    return this.receipt(p, saved);
  }
  async operationStatus(p: Principal, input: unknown) {
    p = await this.actor(p);
    const { operation_id } = c.receiptSchema.parse(input),
      r = await this.core.journal.get(operation_id, actorKey(p));
    if (!r || !r.operation.startsWith("business_")) throw absent();
    await this.receipt(p, r);
    if (
      !r.encryptedIntent ||
      !r.intentExpiresAt ||
      Date.parse(r.intentExpiresAt) <= this.now()
    )
      return this.receipt(p, r);
    if (
      ["accepted_unverified", "unknown_outcome"].includes(r.state) &&
      positiveId(r.result?.native_id)
    ) {
      const i = this.cipher.open(
        r.encryptedIntent,
        `business-write:${identity(p)}:${r.requestKey}:${r.payloadHash}`,
      );
      return this.verify(p, r, i);
    }
    return this.receipt(p, r);
  }
  async contractContext(p: Principal, input: unknown) {
    const { id } = zId(input);
    const contract = await this.get(p, "Contracts", { id });
    const collections = [
      "ContractServices",
      "ContractBlocks",
      "ContractCharges",
      "ContractServiceBundleUnits",
      "ContractServiceUnits",
    ] as const;
    const result: any = { contract: contract.data, collections: {} };
    for (const entity of collections) {
      const page = await this.search(p, entity, {
        contract_id: id,
        page_size: 100,
      });
      result.collections[entity] = {
        data: page.data,
        completeness: page.completeness,
      };
    }
    return {
      status: Object.values(result.collections).every(
        (x: any) => x.completeness.complete,
      )
        ? "succeeded"
        : "partial",
      ...result,
      limitations: [
        "Service adjustment and service bundle adjustment routes are write-only in the captured API contract and are omitted from context reads.",
      ],
    };
  }
  async projectContext(p: Principal, input: unknown) {
    const { id } = zId(input);
    const project = await this.get(p, "Projects", { id });
    const phases = await this.search(p, "Phases", {
      project_id: id,
      page_size: 100,
    });
    const tasks = await this.search(p, "Tasks", {
      project_id: id,
      page_size: 100,
    });
    return {
      status:
        phases.completeness.complete && tasks.completeness.complete
          ? "succeeded"
          : "partial",
      project: project.data,
      phases,
      tasks,
    };
  }
  async invoiceContext(p: Principal, input: unknown) {
    const { id } = zId(input);
    return {
      status: "succeeded",
      invoice: (await this.get(p, "Invoices", { id })).data,
      limitations: [
        "This context read does not post, approve, send or alter an invoice.",
      ],
    };
  }
  async invoiceExport(p: Principal, input: unknown) {
    const { id } = c.invoiceExportSchema.parse(input);
    await this.scoped(p, "Invoices", id);
    return {
      status: "succeeded",
      invoice_id: id,
      format: "pdf",
      export: await this.requestBinary(
        p,
        `Invoices/${id}/InvoicePdf`,
        "Invoices",
      ),
      limitations: [
        "The PDF is a rendered read export. It does not post, approve, send or alter the invoice.",
      ],
    };
  }
  async trueUp(p: Principal, input: unknown) {
    const a = zTrueUp(input),
      contract = await this.get(p, "Contracts", { id: a.contract_id }),
      services = await this.search(p, "ContractServices", {
        contract_id: a.contract_id,
        page_size: a.page_size,
      }),
      units = await this.search(p, "ContractServiceUnits", {
        contract_id: a.contract_id,
        page_size: a.page_size,
      });
    return {
      status:
        services.completeness.complete && units.completeness.complete
          ? "succeeded"
          : "partial",
      contract: contract.data,
      evidence: { services, units },
      calculation: "not_performed",
      warnings: [
        "Effective dates and quantities are evidence only; no billable true-up amount is inferred or applied.",
        "Contract service adjustment endpoints are write-only in the captured API contract and cannot be included as read evidence.",
        "Follow each collection cursor before treating evidence as complete.",
      ],
    };
  }
}

const zId = (input: unknown) => {
  const v = z.object({ id: c.id }).strict().parse(input);
  return v;
};
const zTrueUp = (input: unknown) =>
  z
    .object({
      contract_id: c.id,
      page_size: z.number().int().min(1).max(100).default(50),
    })
    .strict()
    .parse(input);
