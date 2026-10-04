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
    keys(v, ["type", "action", "hour", "minute", "label", "timeZone"]);
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
 return op.action==='set'?`Ask Clock to set ${String(op.hour).padStart(2,'0')}:${String(op.minute).padStart(2,'0')} in ${op.timeZone}${op.label?` named “${op.label}”`:''}. Review the alarm in Clock; Alpha cannot confirm creation or ringing.`:op.action==='show'?'Open Clock’s alarms page.':op.action==='snooze'?`Open Clock so you can choose the intended alarm and snooze it yourself. Select the duration there; ${op.snoozeMinutes} minutes will not be applied automatically. Completion stays unverified.`:'Open Clock so you can choose the intended alarm and dismiss it yourself. Alpha will not dismiss or disable an alarm automatically. Completion stays unverified.';
}

export function validateClockResult(operation:ClockOperation,value:unknown):ClockResult{const status=(value as any)?.status;return validateClockOutcome(operation,value,status==='opened'?'applied':status==='unknown'?'unknown':'failed');}
