/** Android Clock intent handoffs only: never evidence that an alarm exists or rang. */
export const CLOCK_CAPABILITY = "clock.handoff.v1";
export type ClockOperation =
  | {
      type: "clock_handoff";
      action: "set";
      hour: number;
      minute: number;
      label: string;
      timeZone: string;
      /** Repeat days for AlarmClock.EXTRA_DAYS: java.util.Calendar values, Sunday=1 … Saturday=7. */
      days?: ClockDay[];
    }
  | { type: "clock_handoff"; action: "snooze"; snoozeMinutes: number }
  | { type: "clock_handoff"; action: "show" | "dismiss" };
export interface ClockResult {
  kind: "clock-handoff";
  action: ClockOperation["action"];
  status: "opened" | "unavailable" | "denied" | "failed" | "unknown";
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid Clock object");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, required: string[]) {
  if (
    Object.keys(value).length !== required.length ||
    required.some((key) => !Object.hasOwn(value, key))
  )
    throw Error("Unexpected Clock fields");
}
function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw Error("Invalid Clock number");
  return value;
}
export type ClockDay = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const CLOCK_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
/**
 * Repeat days, reconciled with the pinned upstream contract
 * (vendor/eliza/plugins/plugin-assistant/src/services/device-actions/clock-contract.ts):
 * like upstream, any order is accepted and a repeated day is refused. The order is then
 * normalised (ascending), so review text and Clock's EXTRA_DAYS do not depend on it.
 * An empty list is refused: callers omit `days` for a one-off alarm.
 */
export function clockDays(value: unknown): ClockDay[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 7)
    throw Error("Invalid Clock repeat days");
  for (const day of value)
    if (typeof day !== "number" || !Number.isInteger(day) || day < 1 || day > 7)
      throw Error("Invalid Clock repeat days");
  if (new Set(value).size !== value.length) throw Error("Invalid Clock repeat days: a day is repeated");
  return [...value].sort((a, b) => a - b) as ClockDay[];
}
export function describeClockDays(days: readonly ClockDay[]): string {
  if (days.length === 7) return "every day";
  if (days.join() === "2,3,4,5,6") return "weekdays";
  if (days.join() === "1,7") return "weekends";
  return days.map((day) => CLOCK_DAY_NAMES[day - 1]).join(", ");
}
export function clockTimeZone(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 100 ||
    !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)*$/.test(value)
  )
    throw Error("Invalid Clock time zone");
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
  } catch {
    throw Error("Invalid Clock time zone");
  }
  return value;
}
export function isClockOperation(value: unknown): value is ClockOperation {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "clock_handoff"
  );
}
export function validateClockOperation(value: unknown): ClockOperation {
  const v = object(value);
  if (v.type !== "clock_handoff") throw Error("Invalid Clock operation");
  if (v.action === "set") {
    keys(v, Object.hasOwn(v, "days") ? ["type", "action", "hour", "minute", "label", "timeZone", "days"] : ["type", "action", "hour", "minute", "label", "timeZone"]);
    if (
      typeof v.label !== "string" ||
      v.label.length > 200 ||
      /[\u0000-\u001f\u007f]/.test(v.label)
    )
      throw Error("Invalid Clock label");
    return {
      type: v.type,
      action: v.action,
      hour: integer(v.hour, 0, 23),
      minute: integer(v.minute, 0, 59),
      label: v.label,
      timeZone: clockTimeZone(v.timeZone),
      // Like upstream clock.handoff.v2, an operation's [] is an explicit one-off: it is
      // normalised to an omitted `days`, so Clock never receives an empty EXTRA_DAYS.
      ...(Object.hasOwn(v, "days") && !(Array.isArray(v.days) && v.days.length === 0) ? { days: clockDays(v.days) } : {}),
    };
  }
  if (v.action === "snooze") {
    keys(v, ["type", "action", "snoozeMinutes"]);
    return {
      type: v.type,
      action: v.action,
      snoozeMinutes: integer(v.snoozeMinutes, 1, 60),
    };
  }
  keys(v, ["type", "action"]);
  if (v.action !== "show" && v.action !== "dismiss")
    throw Error("Invalid Clock action");
  return { type: v.type, action: v.action };
}
export function assertClockObservation(
  operation: ClockOperation,
  value: unknown,
) {
  if (operation.action !== "set") return;
  const v = object(value);
  if (
    v.sensitive !== false ||
    !Number.isSafeInteger(v.revision) ||
    Number(v.revision) < 0 ||
    clockTimeZone(v.timeZone) !== operation.timeZone
  )
    throw Error("Clock time zone observation unavailable or changed");
}
export function validateClockOutcome(
  operation: ClockOperation,
  value: unknown,
  outcome: unknown,
): ClockResult {
  const v = object(value);
  keys(v, ["kind", "action", "status"]);
  if (v.kind !== "clock-handoff" || v.action !== operation.action)
    throw Error("Clock result binding changed");
  const valid =
    outcome === "applied"
      ? v.status === "opened"
      : outcome === "unknown"
        ? v.status === "unknown"
        : outcome === "failed" || outcome === "not_applied"
          ? ["unavailable", "denied", "failed"].includes(String(v.status))
          : false;
  if (!valid) throw Error("Clock result cannot establish this outcome");
  return {
    kind: v.kind,
    action: operation.action,
    status: v.status as ClockResult["status"],
  };
}

export type ClockHandoffResult = ClockResult;
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
