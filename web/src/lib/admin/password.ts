import { hash, verify } from "@node-rs/argon2";

export function hashPassword(pw: string): Promise<string> {
  return hash(pw);
}

export function verifyPassword(hashed: string, pw: string): Promise<boolean> {
  return verify(hashed, pw).catch(() => false);
}
