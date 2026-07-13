import '@tarojs/components';

declare module '@tarojs/components' {
  interface ButtonProps {
    /** H5 accessibility role; ignored by Mini Program runtimes. */
    role?: string;
  }
}
