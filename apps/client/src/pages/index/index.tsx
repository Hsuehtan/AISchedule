import { Text, View } from '@tarojs/components';

import styles from './index.module.scss';

export default function IndexPage() {
  return (
    <View className={styles.page!}>
      <Text className={styles.eyebrow!}>ELECTRIC INK</Text>
      <Text className={styles.title!}>工程骨架已就绪</Text>
      <Text className={styles.copy!}>Production V3 交互壳将在 T06-T09 完成。</Text>
    </View>
  );
}
