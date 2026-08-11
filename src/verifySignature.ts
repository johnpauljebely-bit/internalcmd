import { createPublicKey, verify } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const SIGNATURE_HEADER = "x-signature-ed25519";
const TIMESTAMP_HEADER = "x-signature-timestamp";

function loadPublicKey(base64Spki: string) {
  return createPublicKey({
    key: Buffer.from(base64Spki, "base64"),
    format: "der",
    type: "spki",
  });
}

export function createErlcSignatureVerifier(base64Spki: string) {
  const publicKey = loadPublicKey(base64Spki);

  return function verifyErlcSignature(req: Request, res: Response, next: NextFunction) {
    const signatureHex = req.header(SIGNATURE_HEADER);
    const timestamp = req.header(TIMESTAMP_HEADER);
    const rawBody = req.body as Buffer;

    if (!signatureHex || !timestamp || !Buffer.isBuffer(rawBody)) {
      console.warn(
        `[webhook] rejected request from ${req.ip}: missing signature headers or raw body ` +
          `(headers present: ${Object.keys(req.headers).join(", ")})`,
      );
      res.status(401).send("missing signature headers or raw body");
      return;
    }

    const message = Buffer.concat([Buffer.from(timestamp, "utf8"), rawBody]);
    const signature = Buffer.from(signatureHex, "hex");

    let valid: boolean;
    try {
      valid = verify(null, message, publicKey, signature);
    } catch (err) {
      console.warn(`[webhook] signature verification threw: ${err}`);
      valid = false;
    }

    if (!valid) {
      console.warn(`[webhook] rejected request from ${req.ip}: invalid signature`);
      res.status(401).send("invalid signature");
      return;
    }

    next();
  };
}
