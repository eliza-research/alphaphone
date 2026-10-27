package ai.elizaresearch.alphaphone;
import java.util.List;
import org.json.JSONObject;
public class CloudSmsCodeTest {
 public static void main(String[] args)throws Exception{
  for(String phone:new String[]{null,"","4155550100","+01234567","+1 4155550100","+12345","+1234567890123456","+１２３４５６７"}){
   check(!CloudSmsCode.validPhone(phone));
   try{CloudSmsCode.sendBody(CloudSignInFlow.Environment.PRODUCTION,phone);throw new AssertionError("invalid phone accepted");}catch(IllegalArgumentException expected){}
  }
  for(String path:new String[]{CloudSmsCode.SEND_PATH,CloudSmsCode.VERIFY_PATH}){
   check(ConnectionRoutes.signInRoute(path,"POST",true));
   check(!ConnectionRoutes.signInRoute(path,"GET",false));
   check(!ConnectionRoutes.signInRoute(path,"POST",false));
   check(!ConnectionRoutes.signInRoute(path+"/extra","POST",true));
  }
  check(!ConnectionRoutes.signInRoute("/steward/cloud-owner-phone/auth/sms/send","POST",true));
  String phone="+14155550100";
  for(CloudSignInFlow.Environment env:CloudSignInFlow.Environment.values()){
   JSONObject sent=CloudSmsCode.sendBody(env,phone),verified=CloudSmsCode.verifyBody(env,phone,"123456");
   check(sent.length()==2&&sent.getString("phone").equals(phone)&&sent.getString("tenantId").equals(env.tenant));
   check(verified.length()==3&&verified.getString("code").equals("123456")&&verified.getString("tenantId").equals(env.tenant));
   for(String code:new String[]{null,"12345","1234567","abcdef"})try{CloudSmsCode.verifyBody(env,phone,code);throw new AssertionError("invalid code accepted");}catch(IllegalArgumentException expected){}
  }
  check(CloudSmsCode.offered(200,true,null,null));
  check(!CloudSmsCode.offered(503,true,false,null));
  check(!CloudSmsCode.offered(200,"true",false,null));
  check(!CloudSmsCode.offered(200,false,false,null));
  check(!CloudSmsCode.offered(200,true,true,null));
  check(!CloudSmsCode.offered(200,true,true,List.of("sms_otp")));
  check(!CloudSmsCode.offered(200,true,true,List.of("sms")));
  check(CloudSmsCode.offered(200,true,true,List.of("email_otp")));
  System.out.println("PASS SMS adapter tenant binding, validation and captcha admission");
 }
 static void check(boolean value){if(!value)throw new AssertionError();}
}
