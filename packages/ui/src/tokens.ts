export const electricInkTokens = {
  color: {
    ink: '#101420',
    action: '#00D8FF',
    tint: '#E1F9FF',
    screen: '#F6F9FF',
    paper: '#FFFFFF',
    canvas: '#DDE7F2',
    muted: '#566073',
    border: '#D7E0EC',
    controlBorder: '#B7C6D8',
    pink: '#FF5F8F',
    green: '#00BFA6',
    violet: '#7B61FF',
    amber: '#FFAD00',
  },
  layout: {
    referenceWidth: 390,
    referenceHeight: 844,
    minimumWidth: 320,
    maximumWidth: 480,
    contentWidth: 354,
    gutter: 18,
    minimumHitArea: 44,
  },
  radius: {
    screen: 30,
    panel: 20,
    card: 16,
    control: 14,
    pill: 999,
  },
  component: {
    statusBarHeight: 28,
    smartInboxHeight: 112,
    taskRowHeight: 76,
    composerHeight: 64,
  },
  shadow: {
    screen: '0 14px 34px rgba(16, 20, 32, 0.13)',
    panel: '0 10px 28px rgba(0, 216, 255, 0.20)',
    card: '0 5px 14px rgba(16, 20, 32, 0.07)',
    action: '0 6px 16px rgba(0, 216, 255, 0.20)',
  },
} as const;

export type ElectricInkColor = keyof typeof electricInkTokens.color;
