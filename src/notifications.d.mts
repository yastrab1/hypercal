export const notificationPresets:number[];
export function validNotification(value:string):boolean;
export function notificationFields(value:string):{useDefaultReminders?:boolean;reminderMinutes?:number|null};
export function notificationParts(value:string):{amount:number;unit:number};
