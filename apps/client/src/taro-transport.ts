import Taro from '@tarojs/taro';

import type { ApiTransport } from './api-client';

export const taroTransport: ApiTransport = async ({ body, headers, method, url }) => {
  const response = await Taro.request({
    credentials: 'include',
    data: body,
    dataType: 'json',
    header: headers,
    method,
    url,
  });

  return { data: response.data, status: response.statusCode };
};
