import { loginWithUsernameSchema, registerWithUsernameSchema } from '@ai-schedule/contracts';
import { AppShell, ElectricButton } from '@ai-schedule/ui';
import { useMutation } from '@tanstack/react-query';
import { Form, Input, Text, View } from '@tarojs/components';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { ApiRequestError } from '../api-client';
import { useAuthBoundary } from '../auth-boundary-context';
import { queryClient, scheduleApi } from '../app-runtime';
import { replaceAppRoute } from '../platform-router';
import './prototype-screens.scss';
import './production-screens.scss';

type AuthMode = 'login' | 'register';

type AuthFormValues = {
  password: string;
  phone: string;
  username: string;
};

export function AuthScreen({ mode }: { mode: AuthMode }) {
  const { markAuthenticated } = useAuthBoundary();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    control,
    formState: { errors },
    handleSubmit,
    setError,
  } = useForm<AuthFormValues>({
    defaultValues: { password: '', phone: '', username: '' },
  });
  const mutation = useMutation({
    mutationFn: async (values: AuthFormValues) => {
      if (mode === 'login') {
        const input = loginWithUsernameSchema.parse({
          password: values.password,
          username: values.username,
        });
        return scheduleApi.login(input);
      }
      const input = registerWithUsernameSchema.parse({
        password: values.password,
        ...(values.phone.trim() ? { phone: values.phone.trim() } : {}),
        username: values.username,
      });
      return scheduleApi.register(input);
    },
    onSuccess: (result) => {
      markAuthenticated();
      queryClient.setQueryData(['users', 'me'], result.user);
      void replaceAppRoute('tasks');
    },
  });

  const submit = handleSubmit((values) => {
    setServerError(null);
    const candidate =
      mode === 'login'
        ? { password: values.password, username: values.username }
        : {
            password: values.password,
            ...(values.phone.trim() ? { phone: values.phone.trim() } : {}),
            username: values.username,
          };
    const parsed = (
      mode === 'login' ? loginWithUsernameSchema : registerWithUsernameSchema
    ).safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'username' || field === 'password' || field === 'phone') {
          setError(field, { message: issue.message });
        }
      }
      return;
    }
    mutation.mutate(values, {
      onError: (error) => {
        setServerError(
          error instanceof ApiRequestError ? error.message : '暂时无法连接服务，请稍后重试',
        );
      },
    });
  });

  const isRegister = mode === 'register';

  return (
    <AppShell className={`loginScreen ${isRegister ? 'registerScreen' : ''}`}>
      <View className="loginHero">
        <View aria-hidden className="brandMark">
          ✓
        </View>
        <Text className="loginTitle">把杂事收进今天</Text>
        <Text className="loginCopy">
          一句话创建、拆解、归档项目待办。{`\n`}保持简单，只做真正会用的链路。
        </Text>
      </View>
      {!isRegister ? (
        <View className="todayPreview" aria-label="产品功能演示">
          <Text className="previewEyebrow">今日编排</Text>
          <Text className="previewTitle">2 件事，已经等你确认</Text>
          <Text className="previewCopy">Smart Inbox 已为你补全时间和项目。</Text>
          <View className="previewTasks">
            <View className="previewTask">写周报</View>
            <View className="previewTask previewTaskAction">交物业费</View>
          </View>
        </View>
      ) : null}
      <Form
        className={`loginCard ${isRegister ? 'registerCard' : ''}`}
        onSubmit={() => void submit()}
      >
        <Text className="formTitle">{isRegister ? '创建账号' : '欢迎回来'}</Text>
        <Text className="formDescription">
          {isRegister ? '用户名用于登录，页面展示名称为“用户”' : '继续今天的安排'}
        </Text>
        <Controller
          control={control}
          name="username"
          render={({ field }) => (
            <Input
              aria-label="用户名"
              className="loginInput"
              maxlength={32}
              onInput={(event) => field.onChange(event.detail.value)}
              placeholder="用户名"
              value={field.value}
            />
          )}
        />
        {errors.username?.message ? (
          <Text className="fieldError">{errors.username.message}</Text>
        ) : null}
        <Controller
          control={control}
          name="password"
          render={({ field }) => (
            <Input
              aria-label="密码"
              className="loginInput"
              maxlength={128}
              onInput={(event) => field.onChange(event.detail.value)}
              password
              placeholder="密码（至少 8 个字符）"
              value={field.value}
            />
          )}
        />
        {errors.password?.message ? (
          <Text className="fieldError">{errors.password.message}</Text>
        ) : null}
        {isRegister ? (
          <>
            <Controller
              control={control}
              name="phone"
              render={({ field }) => (
                <Input
                  aria-label="手机号（选填）"
                  className="loginInput"
                  maxlength={11}
                  onInput={(event) => field.onChange(event.detail.value)}
                  placeholder="手机号（选填，暂不用于登录）"
                  type="number"
                  value={field.value}
                />
              )}
            />
            {errors.phone?.message ? (
              <Text className="fieldError">{errors.phone.message}</Text>
            ) : null}
          </>
        ) : null}
        {serverError ? (
          <Text aria-live="polite" className="formError">
            {serverError}
          </Text>
        ) : null}
        <ElectricButton
          ariaLabel={isRegister ? '注册并登录' : '登录'}
          className="loginButton"
          disabled={mutation.isPending}
          onClick={() => void submit()}
        >
          {mutation.isPending ? '请稍候…' : isRegister ? '注册并登录' : '登录'}
        </ElectricButton>
        <ElectricButton
          ariaLabel={isRegister ? '返回登录' : '注册新账号'}
          className="registerLink"
          onClick={() => void replaceAppRoute(isRegister ? 'login' : 'register')}
          variant="secondary"
        >
          {isRegister ? '已有账号？返回登录' : '没有账号？注册'}
        </ElectricButton>
      </Form>
    </AppShell>
  );
}
