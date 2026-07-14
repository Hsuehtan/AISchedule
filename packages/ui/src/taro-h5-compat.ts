import type {} from '@tarojs/components/types/Button';

// Taro's cross-platform Button type omits the standard H5 tabIndex attribute even
// though the H5 custom element forwards it. Keep this augmentation in the shared UI
// package so formal product buttons remain keyboard reachable without H5-only casts.
declare module '@tarojs/components/types/Button' {
  interface ButtonProps {
    tabIndex?: number;
  }
}

export {};
