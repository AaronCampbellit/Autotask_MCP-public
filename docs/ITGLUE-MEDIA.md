# IT Glue document images

`itg_document_image_create` uploads a staged PNG/JPEG artifact to one authorized document. The artifact must belong to the same company and current actor. Its ownership, expiry, filename, MIME, byte count and hash are rechecked before dispatch. Uploads are limited to 5 MB; PNG dimensions are bounded. These checks validate the upload envelope and basic image framing; they do not claim image decoding or malware scanning.

The [official Document Images API](https://api.itglue.com/developer/#document-images) defines `POST /document_images` with JSON:API type `document-images`, a document target, and base64 image content plus its filename. The helper validates the returned image/document relationship and reads the image back. It returns only the checked relative inline image reference. It never fetches provider storage URLs, forwards credentials to storage, or substitutes a URL for the image bytes.

The upload does not edit a section. Inserting the image is a separate explicit section update using its returned relative reference; the official API distinguishes that reference from the external rendered-image URL. Gallery targeting is not exposed by this implementation.

A durable encrypted receipt is reserved before processing the upload. Ambiguous dispatch cannot be replayed with the same key. Image bytes and signed storage URLs are excluded from receipts. A known image whose readback fails remains accepted/unverified. No rollback deletion occurs.

Tests cover exact upload bytes/envelope, same-company enforcement, changed artifacts, revocation, malformed images, wrong provider parents, concurrent deduplication and unknown outcomes. Live uploads were not performed.
