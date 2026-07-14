import { z } from 'zod';

import { userIdSchema } from './ids.js';

const USERNAME_PATTERN = /^[\p{Script=Han}A-Za-z0-9_-]{3,32}$/u;
const NICKNAME_PATTERN = /^[\p{Script=Han}A-Za-z]{1,10}$/u;
const MAINLAND_PHONE_PATTERN = /^1[3-9]\d{9}$/;
const utcDateTimeSchema = z.string().datetime({ offset: true });

export function normalizeUsername(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

export const usernameSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').trim())
  .pipe(z.string().regex(USERNAME_PATTERN, '用户名需为 3-32 个中英文、数字、下划线或短横线'));

export const normalizedUsernameSchema = usernameSchema.transform(normalizeUsername);

export const nicknameSchema = z.string().regex(NICKNAME_PATTERN, '昵称需为 1-10 个中文或英文字母');

export const passwordSchema = z
  .string()
  .min(8, '密码至少需要 8 个字符')
  .max(128, '密码最多支持 128 个字符');

export const mainlandPhoneSchema = z
  .string()
  .regex(MAINLAND_PHONE_PATTERN, '请输入有效的中国大陆手机号');

export const registerWithUsernameSchema = z
  .object({
    username: usernameSchema,
    password: passwordSchema,
    phone: mainlandPhoneSchema.optional(),
  })
  .strict();

export const loginWithUsernameSchema = z
  .object({
    username: usernameSchema,
    password: passwordSchema,
  })
  .strict();

export const publicUserSchema = z
  .object({
    id: userIdSchema,
    username: usernameSchema,
    nickname: nicknameSchema,
    phone: mainlandPhoneSchema.nullable(),
    phoneVerified: z.boolean(),
    locale: z.string().min(2).max(16),
    timezone: z.string().min(1).max(64),
  })
  .strict();

export const authResponseSchema = z.object({ user: publicUserSchema }).strict();

export const logoutResponseSchema = z.object({ loggedOut: z.literal(true) }).strict();

export const sessionResponseSchema = z.discriminatedUnion('authenticated', [
  z
    .object({
      authenticated: z.literal(true),
      user: publicUserSchema,
      expiresAt: utcDateTimeSchema,
    })
    .strict(),
  z.object({ authenticated: z.literal(false), user: z.null(), expiresAt: z.null() }).strict(),
]);

export type RegisterWithUsernameInput = z.infer<typeof registerWithUsernameSchema>;
export type LoginWithUsernameInput = z.infer<typeof loginWithUsernameSchema>;
export type PublicUser = z.infer<typeof publicUserSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
export type LogoutResponse = z.infer<typeof logoutResponseSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
