import { AppError } from "../../contracts/src/index.js";
/** FileQueryResultModel: validate the invoice association and bytes, never treat a JSON error as PDF. */
export function decodeInvoicePdf(value: unknown, invoiceId: number) {
  const bad = () =>
    new AppError(
      "dependency_unavailable",
      "The invoice PDF response did not match the requested invoice and verified file envelope.",
    );
  if (!value || typeof value !== "object" || Array.isArray(value)) throw bad();
  const v = value as Record<string, unknown>;
  if (
    v.id !== invoiceId ||
    v.contentType !== "application/pdf" ||
    typeof v.fileName !== "string" ||
    !v.fileName.trim() ||
    v.fileName.length > 255 ||
    /[\r\n\0]/.test(v.fileName) ||
    !Number.isSafeInteger(v.fileSize) ||
    Number(v.fileSize) <= 0 ||
    Number(v.fileSize) > 4 * 1024 * 1024
  )
    throw bad();
  let bytes: Buffer;
  if (Array.isArray(v.data)) {
    if (
      v.data.length !== v.fileSize ||
      v.data.some((x) => !Number.isInteger(x) || x < 0 || x > 255)
    )
      throw bad();
    bytes = Buffer.from(v.data);
  } else if (
    typeof v.data === "string" &&
    v.data.length <= Math.ceil((4 * 1024 * 1024) / 3) * 4 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(v.data) &&
    v.data.length % 4 === 0
  ) {
    bytes = Buffer.from(v.data, "base64");
    if (bytes.toString("base64") !== v.data) throw bad();
  } else throw bad();
  if (
    bytes.length !== v.fileSize ||
    bytes.subarray(0, 5).toString("ascii") !== "%PDF-"
  )
    throw bad();
  return {
    content_type: "application/pdf",
    file_name: v.fileName,
    data_base64: bytes.toString("base64"),
    bytes: bytes.length,
  };
}
