import type { NativeCloudSignInController } from '@elizaos/ui/android-cloud/native-cloud-sign-in-controller';
import { NativeCloudSignInView } from '@elizaos/ui/android-cloud/NativeCloudSignInView';
import { cloudServiceName, type CloudEnvironment } from './cloud-protocol';
import type { ReactNode } from 'react';

export function AlphaAuthBrand() {
  return <div className="alpha-auth-brand"><span className="alpha-auth-mark" aria-hidden="true"/><span className="serif">Alpha</span></div>;
}
/** Product identity and public host notices around the common native sign-in surface. */
export function CloudSignInPanel({controller,serviceLoader,dismissible,extra,message,error,errorIsNotice}: {
  controller: NativeCloudSignInController<CloudEnvironment>;
  serviceLoader: (environment:CloudEnvironment)=>Promise<unknown>;
  dismissible:boolean;extra?:ReactNode;message:string;error:string;errorIsNotice:boolean;
}) {
  return <NativeCloudSignInView controller={controller} embedded dismissible={dismissible}
    copy={{serviceName:cloudServiceName(controller.getSnapshot().environment),productName:'Alpha Phone'}}
    headingId="cloud-sign-in-title" title="Welcome to Alpha." brand={<AlphaAuthBrand/>} serviceLoader={serviceLoader}
    activationMessage={()=>error||'Account verification did not complete. Try again.'}
    extra={<>{message&&<p role="status">{message}</p>}{error&&!controller.getSnapshot().error&&<p role={errorIsNotice?'status':'alert'}>{error}</p>}{extra}</>}/>;
}
