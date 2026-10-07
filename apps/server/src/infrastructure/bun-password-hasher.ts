import type { PasswordHasher } from '../application/ports/password-hasher.ts';

/** Argon2id, Bun's default. */
export class BunPasswordHasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return Bun.password.hash(password, 'argon2id');
  }

  verify(password: string, hash: string): Promise<boolean> {
    return Bun.password.verify(password, hash);
  }
}
