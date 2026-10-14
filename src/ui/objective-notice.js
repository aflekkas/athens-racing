import { notifications } from './notifications.js';
import { objectiveTarget } from '../driving-objectives.js';
export function objectiveNotice(objective,trips,pose){
  const target=objective&&trips?.length?objectiveTarget(objective,trips):null;
  if(target&&Number.isFinite(pose?.s)&&target.s<pose.s-20)notifications.banner('objective-direction','TURN BACK SAFELY',(target.district?target.district+' · ':'')+'FOLLOW THE ROAD',{priority:82,persistent:true});
  else notifications.dismiss('objective-direction');
}
