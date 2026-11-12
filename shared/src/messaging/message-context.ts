import { AsyncLocalStorage } from 'async_hooks';
import { ServiceMessage } from './message-contracts';

export const messageContext = new AsyncLocalStorage<ServiceMessage>();
export const currentServiceMessage = (): ServiceMessage | undefined =>
  messageContext.getStore();
