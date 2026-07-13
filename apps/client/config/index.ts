import { defineConfig, type UserConfigExport } from '@tarojs/cli';

import devConfig from './dev';
import prodConfig from './prod';

export default defineConfig<'vite'>((merge, { command }) => {
  const baseConfig: UserConfigExport<'vite'> = {
    projectName: 'ai-schedule',
    date: '2026-07-13',
    designWidth: 390,
    deviceRatio: {
      390: 1,
    },
    sourceRoot: 'src',
    outputRoot: 'dist',
    framework: 'react',
    compiler: 'vite',
    cache: {
      enable: true,
    },
    plugins: [],
    defineConstants: {},
    copy: {
      patterns: [],
      options: {},
    },
    mini: {},
    h5: {
      publicPath: '/',
      staticDirectory: 'static',
    },
  };

  return merge({}, baseConfig, command === 'build' ? prodConfig : devConfig);
});
