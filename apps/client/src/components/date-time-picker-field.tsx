import { NeutralPressButton } from '@ai-schedule/ui';
import { Picker, Text, View } from '@tarojs/components';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  changeDateTimePickerColumn,
  createDateTimePickerRange,
  createDateTimePickerValue,
  dateTimeSelectionFromPickerValue,
  formatDateTimeSelection,
  resolveDateTimeSelection,
} from './date-time-picker-model';
import './date-time-picker-field.scss';

type DateTimePickerFieldProps = {
  fieldName: 'deadlineAt' | 'reminderAt' | 'scheduledAt';
  label: string;
  onChange: (value: string) => void;
  timeZone: string;
  value: string;
};

type FocusableElement = { focus?: () => void };

const PICKER_FOCUS_RESTORE_DELAY_MS = 400;

export function DateTimePickerField({
  fieldName,
  label,
  onChange,
  timeZone,
  value,
}: DateTimePickerFieldProps) {
  const draftNow = useRef(new Date());
  const pickerOpen = useRef(false);
  const triggerRef = useRef<FocusableElement | null>(null);
  const [draft, setDraft] = useState(() =>
    resolveDateTimeSelection(value, timeZone, draftNow.current),
  );

  useEffect(() => {
    if (value) {
      setDraft(resolveDateTimeSelection(value, timeZone, draftNow.current));
      return;
    }

    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refreshBlankDraft = () => {
      const now = new Date();
      if (!pickerOpen.current) {
        draftNow.current = now;
        setDraft(resolveDateTimeSelection('', timeZone, now));
      }
      const millisecondsIntoMinute = now.getSeconds() * 1_000 + now.getMilliseconds();
      refreshTimer = setTimeout(refreshBlankDraft, 60_050 - millisecondsIntoMinute);
    };

    refreshBlankDraft();
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [timeZone, value]);

  const range = useMemo(() => createDateTimePickerRange(draft), [draft]);
  const pickerValue = useMemo(() => createDateTimePickerValue(draft), [draft]);
  const restoreTriggerFocus = () => {
    setTimeout(() => triggerRef.current?.focus?.(), PICKER_FOCUS_RESTORE_DELAY_MS);
  };

  return (
    <View
      className={`dateTimePickerField dateTimePickerField_${fieldName} ${value ? '' : 'dateTimePickerField_empty'}`}
    >
      <Picker
        className={`dateTimePickerControl dateTimePickerControl_${fieldName}`}
        mode="multiSelector"
        onCancel={() => {
          pickerOpen.current = false;
          setDraft(resolveDateTimeSelection(value, timeZone, draftNow.current));
          restoreTriggerFocus();
        }}
        onChange={(event) => {
          pickerOpen.current = false;
          const confirmed = dateTimeSelectionFromPickerValue(event.detail.value);
          setDraft(confirmed);
          onChange(formatDateTimeSelection(confirmed));
          restoreTriggerFocus();
        }}
        onColumnChange={(event) => {
          setDraft((current) =>
            changeDateTimePickerColumn(current, event.detail.column, event.detail.value),
          );
        }}
        range={range}
        textProps={{ cancelText: '取消', okText: '确定' }}
        value={pickerValue}
      >
        <NeutralPressButton
          role="button"
          ref={triggerRef}
          aria-label={`${label}，${value ? `当前为 ${value}` : '未设置'}，打开日期时间选择器`}
          className="dateTimePickerTrigger"
          onClick={() => {
            pickerOpen.current = true;
            if (!value) {
              const now = new Date();
              draftNow.current = now;
              setDraft(resolveDateTimeSelection('', timeZone, now));
            }
          }}
          tabIndex={0}
        >
          <Text className={value ? 'dateTimePickerValue' : 'dateTimePickerPlaceholder'}>
            {value || '选择日期和时间'}
          </Text>
        </NeutralPressButton>
      </Picker>
      {value ? (
        <NeutralPressButton
          role="button"
          aria-label={`清除${label}`}
          className="dateTimePickerClear"
          onClick={() => {
            const now = new Date();
            onChange('');
            draftNow.current = now;
            setDraft(resolveDateTimeSelection('', timeZone, now));
          }}
          tabIndex={0}
        >
          清除
        </NeutralPressButton>
      ) : null}
    </View>
  );
}
