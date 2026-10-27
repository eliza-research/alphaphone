/** Android Clock intent handoffs only: never evidence that an alarm exists or rang. */
import {
  assertClockObservation as upstreamAssertClockObservation,
  clockDays as upstreamClockDays,
  clockTimeZone,
  validateClockOperation as upstreamValidateClockOperation,
  validateClockResult as upstreamValidateClockResult,
  type ClockDay,
  type ClockHandoffOperation as ClockOperation,
  type ClockHandoffResult as ClockResult,
} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/clock-contract.ts';
export {CLOCK_CAPABILITY, clockTimeZone} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/clock-contract.ts';
export type {ClockDay, ClockHandoffOperation as ClockOperation, ClockHandoffResult as ClockResult, ClockHandoffResult} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/clock-contract.ts';

export const CLOCK_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
/** Alpha's form omits empty repeats and sorts valid upstream days for EXTRA_DAYS. */
export function clockDays(value: unknown): ClockDay[] {
  try {
    const days = upstreamClockDays(value);
    if (days.length === 0) throw Error("Invalid Clock repeat days");
    return days.sort((a, b) => a - b);
  } catch {
    throw Error("Invalid Clock repeat days");
  }
}
export function describeClockDays(days: readonly ClockDay[]): string {
  if (days.length === 7) return "every day";
  if (days.join() === "2,3,4,5,6") return "weekdays";
  if (days.join() === "1,7") return "weekends";
  return days.map((day) => CLOCK_DAY_NAMES[day - 1]).join(", ");
}
export function isClockOperation(value: unknown): value is ClockOperation {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "clock_handoff"
  );
}
export function validateClockOperation(value: unknown): ClockOperation {
  const operation = upstreamValidateClockOperation(value);
  // This renderer implements external Clock handoffs, not Eliza-owned alarms.
  if (operation.type !== "clock_handoff") throw Error("Invalid Clock operation");
  if (operation.action !== "set" || operation.days === undefined) return operation;
  const {days, ...oneOff} = operation;
  // Explicit [] remains a one-off; never send an empty EXTRA_DAYS to Clock.
  return days.length ? {...oneOff, days: days.sort((a, b) => a - b)} : oneOff;
}
export function assertClockObservation(operation: ClockOperation, value: unknown) {
  if (!isClockOperation(operation)) throw Error("Invalid Clock operation");
  upstreamAssertClockObservation(operation, value);
}
export function validateClockOutcome(
  operation: ClockOperation,
  value: unknown,
  outcome: unknown,
): ClockResult {
  if (!isClockOperation(operation)) throw Error("Invalid Clock operation");
  const result = upstreamValidateClockResult(operation, value, outcome);
  if (result.kind !== "clock-handoff") throw Error("Clock result binding changed");
  return result;
}

export function currentClockTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Newer Android ICU/WebView reports the GMT default as an ISO zero offset.
  // Normalize that known UTC equivalent; unknown zones must still fail closed.
  return clockTimeZone(zone === "+00:00" || zone === "-00:00" ? "UTC" : zone);
}
export function assertClockTimeZone(operation:ClockOperation,observed:string|undefined){if(operation.action==='set'&&(operation.timeZone!==observed||operation.timeZone!==currentClockTimeZone()))throw Error('Phone time zone changed. Review the Clock request again.');}
export function describeClockHandoff(op:ClockOperation):string{
 return op.action==='set'?`Ask Clock to set ${String(op.hour).padStart(2,'0')}:${String(op.minute).padStart(2,'0')} in ${op.timeZone}${op.days?`, repeating ${describeClockDays(op.days)}`:''}${op.label?` named “${op.label}”`:''}. Review the alarm in Clock; Alpha cannot confirm creation or ringing.`:op.action==='show'?'Open Clock’s alarms page.':op.action==='snooze'?`Open Clock so you can choose the intended alarm and snooze it yourself. Select the duration there; ${op.snoozeMinutes} minutes will not be applied automatically. Completion stays unverified.`:'Open Clock so you can choose the intended alarm and dismiss it yourself. Alpha will not dismiss or disable an alarm automatically. Completion stays unverified.';
}

export function validateClockResult(operation:ClockOperation,value:unknown):ClockResult{const status=(value as any)?.status;return validateClockOutcome(operation,value,status==='opened'?'applied':status==='unknown'?'unknown':'failed');}

/** Reviewed set request with a repeat (AlarmClock.EXTRA_DAYS); renderer shape with `reviewed: true`. */
export type ClockSetRequest={action:'set';hour:number;minute:number;label:string;timeZone:string;reviewed:true;days?:ClockDay[]};
export type ClockDraftRequest=ClockSetRequest|{action:'snooze';snoozeMinutes:number;reviewed:true}|{action:'show'|'dismiss';reviewed:true};
/** Pure request builder; an empty repeat is a one-time alarm. */
export function buildClockRequest(input:{action:'set'|'show'|'snooze'|'dismiss';time:string;label:string;snooze:string;days:readonly number[]},timeZone:string):ClockDraftRequest{
 const {action,time,label,snooze}=input;
 if(action==='set'){
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||label.length>200||label.includes('\0'))throw Error('Choose a valid time and a label up to 200 characters.');
  const [hour,minute]=time.split(':').map(Number);
  return {action,hour,minute,label:label.trim(),timeZone,reviewed:true,...(input.days.length?{days:clockDays(input.days)}:{})};
 }
 if(action==='snooze'){
  if(!/^\d{1,2}$/.test(snooze)||Number(snooze)<1||Number(snooze)>60)throw Error('Choose 1 to 60 snooze minutes.');
  return {action,snoozeMinutes:Number(snooze),reviewed:true};
 }
 return {action,reviewed:true};
}
