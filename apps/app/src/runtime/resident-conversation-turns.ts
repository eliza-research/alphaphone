import {
  ConversationTurnController,
  type ConversationRoom,
  type ConversationTurnContext,
  type StoppedConversationTurn,
} from '../../../../.eliza/client-features/packages/ui/src/api/conversation-turn-controller.ts';
import type {TurnAbortOutcome} from './remote-protocol';

type Input = {requestId:string;text:string;dispatch:(turn:ConversationTurnContext)=>Promise<unknown>};

/** A verified resident session owns one shared turn controller. Context, drafts and action
 * review remain with their existing owners; this adapter only joins their cancellation signal
 * to the shared send/Stop lifecycle and retains the native Stop receipt for history readback. */
export class ResidentConversationTurns {
  private readonly turns:ConversationTurnController<Input,unknown>;
  private stopReceipt:Promise<TurnAbortOutcome>=Promise.resolve('idle');
  constructor(stop:(room:ConversationRoom)=>Promise<TurnAbortOutcome>,ownershipLost:(error:unknown)=>boolean){
    this.turns=new ConversationTurnController({
      create:async()=>{throw Error('Bind the verified resident conversation before sending.');},
      clientMessageId:input=>input.requestId,
      send:(_room,input,turn)=>input.dispatch(turn),
      stop:room=>{
        const receipt=this.stopReceipt=Promise.resolve().then(()=>stop(room));
        return receipt.then(outcome=>{if(outcome!=='aborted')throw Error('The agent did not confirm stopping this reply.');});
      },
      ownershipLost,
    });
  }
  bind(room:ConversationRoom,signal?:AbortSignal){return this.turns.bind(room,signal);}
  get stopped():StoppedConversationTurn<Input>|null{return this.turns.stopped;}
  get stopResult():Promise<TurnAbortOutcome>{return this.stopReceipt.catch(()=>'unsupported');}
  reset(){return this.turns.reset();}
  send<Reply>(room:ConversationRoom,requestId:string,text:string,signal:AbortSignal,dispatch:(turn:ConversationTurnContext)=>Promise<Reply>):Promise<Reply>{
    return this.turns.request({requestId,text,dispatch},{conversation:room,signal}) as Promise<Reply>;
  }
}
