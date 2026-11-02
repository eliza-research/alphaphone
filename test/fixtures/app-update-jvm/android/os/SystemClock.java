package android.os;
public final class SystemClock {
 /** The wall-clock time of the device's last boot. */
 public static volatile long booted=System.currentTimeMillis()-60000;
 public static long elapsedRealtime(){return System.currentTimeMillis()-booted;}
}
