package ai.elizaresearch.alphaphone.sense;
public final class IndicatorHealthLeaseTest {
 private static void yes(boolean value){if(!value)throw new AssertionError();}
 private static void no(boolean value){yes(!value);}
 public static void main(String[] args){
  IndicatorHealthLease lease=new IndicatorHealthLease();Object first=new Object(),second=new Object();
  no(lease.valid(0));lease.bind(first,0);no(lease.valid(0));
  no(lease.renew(second,0,0,true));
  yes(lease.renew(first,0,0,true));yes(lease.valid(1499));
  lease.bind(first,1400);no(lease.renew(first,0,1400,true));
  no(lease.renew(first,0,1400,true));no(lease.renew(first,-1,1400,true));
  no(lease.valid(1500));yes(lease.lost());no(lease.renew(first,1,1500,true));no(lease.valid(1501));
  lease.bind(second,1600);no(lease.renew(second,0,1600,true));no(lease.valid(1601));
  lease.userRearmed();no(lease.valid(1601));yes(lease.renew(second,1,1601,true));
  lease.revoke(first);yes(lease.valid(1602));lease.revoke(second);no(lease.valid(1602));
  lease.bind(first,1700);no(lease.renew(first,0,1700,true));lease.userRearmed();
  yes(lease.renew(first,1,1700,true));lease.invalidate();no(lease.valid(1701));
  lease.bind(second,2000);lease.userRearmed();yes(lease.renew(second,0,2000,true));
  // A renewal arriving after expiry must notice expiry even before watchdog polling.
  no(lease.renew(second,1,3500,true));no(lease.valid(3501));
  IndicatorHealthLease rebound=new IndicatorHealthLease();rebound.bind(first,0);yes(rebound.renew(first,0,0,true));
  rebound.bind(second,1500);no(rebound.renew(second,0,1500,true));
  IndicatorHealthLease hidden=new IndicatorHealthLease();hidden.bind(first,0);yes(hidden.renew(first,0,0,true));
  no(hidden.renew(first,1,100,false));no(hidden.valid(100));no(hidden.renew(first,2,101,true));
  String cert="a".repeat(64);String[] only={IndicatorHealthIdentity.SYSTEM_UI};
  yes(IndicatorHealthIdentity.accepts(10020,10020,true,true,true,true,true,only,cert,cert));
  no(IndicatorHealthIdentity.accepts(10021,10020,true,true,true,true,true,only,cert,cert));
  no(IndicatorHealthIdentity.accepts(10020,10020,true,true,true,true,true,new String[]{only[0],"other"},cert,cert));
  no(IndicatorHealthIdentity.accepts(10020,10020,true,true,true,true,false,only,cert,cert));
  no(IndicatorHealthIdentity.accepts(10020,10020,true,true,true,true,true,only,"",cert));
  no(IndicatorHealthIdentity.accepts(10020,10020,true,true,true,true,true,only,cert,"b".repeat(64)));
  no(IndicatorHealthIdentity.accepts(10020,10020,false,true,true,true,true,only,cert,cert));
  System.out.println("PASS indicator health lease");
 }
}
