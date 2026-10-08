import {providerFetch} from '../../execution/src/index.js';
import {
  AppError,
  actorKey,
  positiveId,
  type Principal,
  type PrincipalStore,
} from "../../contracts/src/index.js";
import { reauthorize, assertCapability } from "../../policy/src/index.js";
import { requestScheduler } from "../../autotask/src/index.js";
import type { RequestBudgetPort } from "../../autotask/src/budget.js";
import type { WorkManagementOptions } from "./index.js";

type Entity =
  | "Currencies"
  | "TimeEntries"
  | "ExpenseItems"
  | "ExpenseReports"
  | "TimeOffRequests"
  | "BillingCodes"
  | "Roles"
  | "ResourceRoles"
  | "ResourceServiceDeskRoles";
type Field = {
  name: string;
  dataType: string;
  isReadOnly: boolean;
  isPickList?: boolean;
  length?: number;
  picklistValues?: { value: string; label: string; isActive: boolean }[];
};
interface Options {
  tenantId: string;
  baseUrl: string;
  username: string;
  secret: string;
  integrationCode: string;
  principals: PrincipalStore;
  requestBudget: RequestBudgetPort;
  fetch?: typeof fetch;
}
const missing = () =>
  new AppError(
    "missing_metadata",
    "Current work-management field or choice metadata is unavailable.",
  );
/** Fixed metadata and eligibility reads; no client-selected paths or business writes. */
export class WorkManagementMetadata {
  private cache = new Map<Entity, { at: number; fields: Field[] }>();
  constructor(private options: Options) {
    if (
      !/^https:\/\/webservices[1-9]\d*\.autotask\.net\/atservicesrest\/v1\.0\/$/.test(
        options.baseUrl,
      ) ||
      [options.username, options.secret, options.integrationCode].some(
        (v) => !v || /[\r\n\0]/.test(v),
      )
    )
      throw new AppError(
        "invalid_input",
        "Invalid work metadata configuration.",
      );
  }
  private async actor(p: Principal) {
    const fresh = await reauthorize(p, this.options.principals, {
      resourceMaxAgeMs: 240000,
    });
    if (fresh.tenantId !== this.options.tenantId)
      throw new AppError("forbidden", "Work metadata tenant mismatch.");
    assertCapability(fresh, "operational.read");
    return fresh;
  }
  private async read(
    p: Principal,
    entity: Entity,
    kind: "fields" | "query" | "get" | "info",
    input?: unknown,
  ) {
    await this.actor(p);
    const release = await requestScheduler.acquire(actorKey(p), 15000);
    try {
      await this.options.requestBudget.take({
        tenantId: p.tenantId,
        actorKey: actorKey(p),
      });
      await this.actor(p);
      const path =
        kind === "info"
          ? `${entity}/entityInformation`
          : kind === "fields"
          ? `${entity}/entityInformation/fields`
          : kind === "query"
            ? `${entity}/query`
            : `${entity}/${input}`;
      const response = await providerFetch('Autotask',this.options.fetch ?? fetch)(
        new URL(path, this.options.baseUrl),
        {
          method: kind === "query" ? "POST" : "GET",
          ...(kind === "query"
            ? { body: JSON.stringify({ filter: input, MaxRecords: 500 }) }
            : {}),
          redirect: "error",
          signal: AbortSignal.timeout(15000),
          headers: {
            UserName: this.options.username,
            Secret: this.options.secret,
            ApiIntegrationCode: this.options.integrationCode,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw missing();
      }
      const reader = response.body?.getReader();
      if (!reader) throw missing();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const r = await reader.read();
          if (r.done) break;
          bytes += r.value.byteLength;
          if (bytes > 1048576) throw missing();
          chunks.push(r.value);
        }
      } finally {
        await reader.cancel();
      }
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      await this.actor(p);
      if (kind === "info") {
        if (!value.info || typeof value.info.canQuery !== "boolean" || !["None", "All", "Restricted"].includes(value.info.userAccessForQuery)) throw missing();
        return {can_query:value.info.canQuery, query_access:value.info.userAccessForQuery};
      }
      if (kind === "query") {
        if (
          !Array.isArray(value.items) ||
          !value.pageDetails ||
          value.pageDetails.nextPageUrl ||
          value.items.length > 500
        )
          throw missing();
        return value.items;
      }
      if (kind === "get") {
        if (!value.item || value.item.id !== input) throw missing();
        return value.item;
      }
      if (
        !Array.isArray(value.fields) ||
        value.fields.some(
          (f: any) =>
            typeof f.name !== "string" || typeof f.dataType !== "string",
        ) ||
        new Set(value.fields.map((f: any) => f.name)).size !==
          value.fields.length
      )
        throw missing();
      return value.fields;
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw missing();
    } finally {
      release();
    }
  }
  private async fields(p: Principal, entity: Entity): Promise<Field[]> {
    await this.actor(p);
    const old = this.cache.get(entity);
    if (old && Date.now() - old.at < 60000) return old.fields;
    const fields = await this.read(p, entity, "fields");
    this.cache.set(entity, { at: Date.now(), fields });
    return fields;
  }
  private async pick(
    p: Principal,
    entity: Entity,
    name: string,
    labels: string[],
  ) {
    const field = (await this.fields(p, entity)).find((f) => f.name === name);
    if (!field?.isPickList || !Array.isArray(field.picklistValues))
      throw missing();
    const matches = field.picklistValues.filter(
      (v) =>
        v.isActive === true && labels.includes(v.label.trim().toLowerCase()),
    );
    if (matches.length !== 1 || !positiveId(Number(matches[0]!.value)))
      throw missing();
    return Number(matches[0]!.value);
  }
  private async validFields(
    p: Principal,
    entity: Entity,
    body: Readonly<Record<string, unknown>>,
  ) {
    const fields = await this.fields(p, entity);
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue;
      const f = fields.find((f) => f.name === key);
      if (!f || f.isReadOnly !== false) return false;
      if (value === null) continue;
      if (f.isPickList) {
        if (
          !f.picklistValues?.some(
            (v) => v.isActive === true && v.value === String(value),
          )
        )
          return false;
      } else if (f.dataType === "string") {
        if (typeof value !== "string" || value.length > (f.length ?? 32000))
          return false;
      } else if (f.dataType === "boolean") {
        if (typeof value !== "boolean") return false;
      } else if (f.dataType === "datetime") {
        if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
          return false;
      } else if (
        ["integer", "long", "decimal", "double"].includes(f.dataType)
      ) {
        if (
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          (["integer", "long"].includes(f.dataType) &&
            !Number.isSafeInteger(value))
        )
          return false;
      } else return false;
    }
    return true;
  }
  readonly validateTime: NonNullable<WorkManagementOptions["validateTime"]> =
    async (p, body) => {
      if (
        body.resourceID !== p.resourceId ||
        !(await this.validFields(p, "TimeEntries", body))
      )
        return false;
      if (
        body.hoursWorked !== undefined &&
        (typeof body.hoursWorked !== "number" ||
          body.hoursWorked <= 0 ||
          body.hoursWorked > 24)
      )
        return false;
      if (body.roleID !== undefined) {
        if (!positiveId(body.roleID)) return false;
        const role = await this.read(p, "Roles", "get", body.roleID);
        if (role.isActive !== true) return false;
        const entity = positiveId(body.ticketID)
          ? "ResourceServiceDeskRoles"
          : "ResourceRoles";
        const assignments = await this.read(p, entity, "query", [
          { field: "resourceID", op: "eq", value: p.resourceId },
        ]);
        if (
          !assignments.some(
            (r: any) =>
              r.resourceID === p.resourceId &&
              r.roleID === body.roleID &&
              r.isActive === true,
          )
        )
          return false;
      }
      for (const key of ["billingCodeID", "internalBillingCodeID"] as const) {
        if (body[key] === undefined) continue;
        if (!positiveId(body[key])) return false;
        const code = await this.read(p, "BillingCodes", "get", body[key]);
        if (code.isActive !== true) return false;
        const field = (await this.fields(p, "BillingCodes")).find(
          (f) => f.name === "useType",
        );
        const label = field?.picklistValues
          ?.find((v) => v.isActive === true && v.value === String(code.useType))
          ?.label.toLowerCase()
          .replace(/[^a-z]/g, "");
        if (
          !label ||
          !(
            key === "internalBillingCodeID"
              ? [
                  "internalactivity",
                  "generalactivity",
                  "internalallocationcode",
                  "generaltime",
                  "regularinternaltime",
                  "internaltime",
                ]
              : [
                  "worktype",
                  "worktypegeneral",
                  "generalallocationcode",
                  "ticketslabor",
                ]
          ).includes(label)
        )
          return false;
      }
      return true;
    };
  readonly validateExpense: NonNullable<
    WorkManagementOptions["validateExpense"]
  > = async (p, body) => {
    if(!(await this.validFields(p, "ExpenseItems", body)))return false;
    if(body.expenseCurrencyID!==undefined){
      if(!positiveId(body.expenseCurrencyID))return false;
      const currency=await this.read(p,"Currencies","get",body.expenseCurrencyID);
      if(currency.isActive!==true)return false;
    }
    return true;
  };
  readonly validateTimeOff: NonNullable<
    WorkManagementOptions["validateTimeOff"]
  > = async (p, body) => {
    if (
      body.resourceID !== p.resourceId ||
      typeof body.hours !== "number" ||
      body.hours <= 0 ||
      body.hours > 24 ||
      typeof body.requestDate !== "string" ||
      !Number.isFinite(Date.parse(body.requestDate))
    )
      return false;
    const fields = await this.fields(p, "TimeOffRequests");
    for (const key of ["status", "timeOffRequestType"]) {
      const field = fields.find((f) => f.name === key);
      if (
        !field?.isPickList ||
        !field.picklistValues?.some(
          (v) => v.isActive === true && v.value === String(body[key]),
        )
      )
        return false;
    }
    return true;
  };
  readonly resolveExpenseStatuses: NonNullable<
    WorkManagementOptions["resolveExpenseStatuses"]
  > = async (p) => ({
    inProgress: await this.pick(p, "ExpenseReports", "status", ["in progress"]),
    rejected: await this.pick(p, "ExpenseReports", "status", ["rejected"]),
    submitted: await this.pick(p, "ExpenseReports", "status", ["submitted", "awaiting approval"]),
  });
  readonly resolveTimeOffStatuses: NonNullable<
    WorkManagementOptions["resolveTimeOffStatuses"]
  > = async (p) => {
    const submitted = await this.pick(p, "TimeOffRequests", "status", ["submitted"]);
    const canceled = await this.pick(p, "TimeOffRequests", "status", ["canceled", "cancelled"]);
    let approved: number | undefined, rejected: number | undefined;
    try { approved = await this.pick(p, "TimeOffRequests", "status", ["approved"]); } catch (error) { if (!(error instanceof AppError) || error.code !== 'missing_metadata') throw error; }
    try { rejected = await this.pick(p, "TimeOffRequests", "status", ["rejected"]); } catch (error) { if (!(error instanceof AppError) || error.code !== 'missing_metadata') throw error; }
    return {submitted, canceled, ...(approved === undefined ? {} : {approved}), ...(rejected === undefined ? {} : {rejected})};
  };
  callbacks(): WorkManagementOptions {
    return {
      validateTime: this.validateTime,
      validateExpense: this.validateExpense,
      validateTimeOff: this.validateTimeOff,
      resolveExpenseStatuses: this.resolveExpenseStatuses,
      resolveTimeOffStatuses: this.resolveTimeOffStatuses,
    };
  }
  async choices(p: Principal, kind: "time" | "expenses" | "time_off") {
    const entities: Entity[] =
      kind === "time"
        ? ["TimeEntries", "BillingCodes"]
        : kind === "expenses"
          ? ["ExpenseReports", "ExpenseItems"]
          : ["TimeOffRequests"];
    const output: Record<string, unknown> = {};
    for (const entity of entities)
      output[entity] = (await this.fields(p, entity)).map((f) => ({
        name: f.name,
        type: f.dataType,
        read_only: f.isReadOnly,
        ...(f.isPickList
          ? {
              choices: f.picklistValues
                ?.filter((v) => v.isActive === true)
                .map((v) => ({ value: v.value, label: v.label })),
            }
          : {}),
        ...(f.length ? { max_length: f.length } : {}),
      }));
    let currencies: Record<string, unknown>[] | undefined;
    let currencyUnavailable = false;
    let currencyAccess: {can_query:boolean;query_access:string} | undefined;
    if (kind === "expenses") {
      try {
        currencyAccess = await this.read(p, "Currencies", "info");
        if (!currencyAccess?.can_query || currencyAccess.query_access === "None") throw missing();
        currencies = (await this.read(p, "Currencies", "query", [{field:"isActive",op:"eq",value:true}]))
          .filter((row:any) => row.isActive === true && positiveId(row.id))
          .map((row:any) => ({id:row.id,name:row.name,description:row.description,display_symbol:row.displaySymbol,is_internal_currency:row.isInternalCurrency}));
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== "missing_metadata") throw error;
        currencyUnavailable = true;
      }
    }
    await this.actor(p);
    return {
      status: currencyUnavailable ? "partial" : "succeeded",
      fields: output,
      ...(currencies ? {currencies} : {}),
      ...(currencyAccess ? {currency_access:currencyAccess} : {}),
      ...(kind === "expenses" ? {currency_lookup: currencyUnavailable ? "unavailable" : "available"} : {}),
      limitations: [
        ...(currencyUnavailable ? ["Currency lookup is unavailable to the configured API account or incomplete. Check currency_access when present; query_access None requires an Autotask API-user security-level change. No currency IDs are inferred; expense-item writes still require independent active-currency validation."] : []),
        "Metadata choices do not guarantee eligibility. Native timesheet, contract, proxy-entry and approval rules still apply.",
        "No mutation or permission grant is performed.",
      ],
    };
  }
}
