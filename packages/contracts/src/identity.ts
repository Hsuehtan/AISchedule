import { z } from 'zod';

const USERNAME_PATTERN = /^[\p{Script=Han}A-Za-z0-9_-]{3,32}$/u;
const NICKNAME_PATTERN = /^[\p{Script=Han}A-Za-z]{1,10}$/u;
const MAINLAND_PHONE_PATTERN = /^1[3-9]\d{9}$/;

export function normalizeUsername(value: string): string {
  return value.normalize('NFKC').trim().replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

export const usernameSchema = z
  .string()
  .trim()
  .regex(USERNAME_PATTERN, '用户名需为 3-32 个中英文、数字、下划线或短横线');

export const normalizedUsernameSchema = usernameSchema.transform(normalizeUsername);

export const nicknameSchema = z
  .string()
  .regex(NICKNAME_PATTERN, '昵称需为 1-10 个中文或英文字母');

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

export const updateProfileSchema = z.object({ nickname: nicknameSchema }).strict();

export type RegisterWithUsernameInput = z.infer<typeof registerWithUsernameSchema>;
export type LoginWithUsernameInput = z.infer<typeof loginWithUsernameSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
