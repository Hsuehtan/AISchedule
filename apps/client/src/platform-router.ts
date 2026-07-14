import Taro from '@tarojs/taro';

export const appRoutes = {
  boot: '/pages/index/index',
  login: '/pages/login/index',
  register: '/pages/register/index',
  tasks: '/pages/tasks/index',
} as const;

export type AppRoute = keyof typeof appRoutes;

export async function replaceAppRoute(route: AppRoute): Promise<void> {
  await Taro.reLaunch({ url: appRoutes[route] });
}
