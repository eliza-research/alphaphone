package android.provider;
/**
 * JVM stand-in for the CalendarContract names CalendarAvailabilityReader and the pinned
 * shared readers use. Column names and values are the platform's published constants, so the
 * SQL the reader builds is the SQL CalendarProvider would receive. Test-only.
 */
public final class CalendarContract {
 public static final String ACCOUNT_TYPE_LOCAL="LOCAL";
 public static final class Attendees {
  public static final android.net.Uri CONTENT_URI=new android.net.Uri("attendees");
  public static final int ATTENDEE_STATUS_NONE=0,ATTENDEE_STATUS_ACCEPTED=1,ATTENDEE_STATUS_DECLINED=2,ATTENDEE_STATUS_INVITED=3,ATTENDEE_STATUS_TENTATIVE=4;
 }
 public static final class Reminders {public static final android.net.Uri CONTENT_URI=new android.net.Uri("reminders");}
 public static final class Calendars {
  public static final android.net.Uri CONTENT_URI=new android.net.Uri("calendars");
  public static final String ACCOUNT_TYPE="account_type";
  public static final String _ID="_id",CALENDAR_DISPLAY_NAME="calendar_displayName",CALENDAR_ACCESS_LEVEL="calendar_access_level";
  public static final int CAL_ACCESS_NONE=0,CAL_ACCESS_FREEBUSY=100,CAL_ACCESS_READ=200,CAL_ACCESS_CONTRIBUTOR=500,CAL_ACCESS_OWNER=700;
 }
 public static final class Instances {
  public static final android.net.Uri CONTENT_URI=new android.net.Uri("instances");
  public static final String CALENDAR_ID="calendar_id",EVENT_ID="event_id",TITLE="title",BEGIN="begin",END="end",ALL_DAY="allDay",
   AVAILABILITY="availability",STATUS="eventStatus",SELF_ATTENDEE_STATUS="selfAttendeeStatus",
   DESCRIPTION="description",EVENT_LOCATION="eventLocation",RRULE="rrule";
 }
 public static final class Events {
  public static final android.net.Uri CONTENT_URI=new android.net.Uri("events");
  public static final String DELETED="deleted";
  public static final int AVAILABILITY_BUSY=0,AVAILABILITY_FREE=1,AVAILABILITY_TENTATIVE=2;
  public static final int STATUS_TENTATIVE=0,STATUS_CONFIRMED=1,STATUS_CANCELED=2;
 }
}
