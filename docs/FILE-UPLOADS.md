# File uploads

Ticket and opportunity staging accept all file extensions as opaque bytes. Common extensions receive their conventional MIME type; unfamiliar formats use a supplied valid MIME type or application/octet-stream. This is local transport support, not a guarantee that Autotask accepts every file type. Autotask remains authoritative for native attachment restrictions.

Original filenames and bytes are retained, including CSV encodings, formulas, archives, and Office files. Uploads are never converted into TXT or reconstructed from extracted text. Generated CSV exports still neutralize formulas. Staging checks safe filenames, canonical base64, ownership, size, and quotas; it does not validate document contents or scan for malware.

Supply either original base64 bytes with filename, or a real ChatGPT file object containing download_url and file_id plus the original filename (filename or file.file_name). Bare file IDs and sandbox paths are not downloadable by the remote server. Only approved HTTPS file hosts are fetched, without redirects or application credentials. When no downloadable file reference is available, use the authenticated console to select the original file.

The staging limit remains 6 MB. Base64 MCP requests must also fit the 64 KiB request limit; file references and the authenticated console avoid putting large base64 strings in MCP arguments. Staging is local only; ticket_attachment_upload or opportunity_attachment_upload performs the native write. Both staging operations appear in write discovery. Native verification checks filename, MIME, byte hash, and other attachment fields before reporting success.

New artifact filenames are authenticated with the encrypted bytes. Older staged records retain their existing generated names and encryption compatibility. Downloads use attachment disposition with UTF-8 filenames. Existing native attachments are not rewritten.
