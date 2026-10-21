export class RouteNavigation {
 constructor(route){this.route=route;this.reset();}
 reset(){this.cursorS=0;this.offRoute=false;this.wrongWay=false;this.outT=this.inT=this.wrongT=0;this.lastNotice=-Infinity;}
 update({dt,position,heading,speed,earnedS=0,time=0,contact}){const q=this.route.project(position.x,position.z,{hint:this.cursorS,referenceY:position.y,layer:contact?.layer,heading,maxTravel:80}),f=this.route.frame(q.s),physical=!!contact&&contact.layer===q.layer&&Math.abs(contact.y-q.y)<.75&&(this.route.contactAllowed?this.route.contactAllowed(q,contact):contact.surfaceId===q.surfaceId),outside=!physical||q.u < -f.leftM-3||q.u>f.rightM+3,inside=physical&&q.u>=-f.leftM-1&&q.u<=f.rightM+1;
 this.cursorS=q.s;this.outT=outside?this.outT+dt:0;this.inT=inside?this.inT+dt:0;if(this.outT>=.75)this.offRoute=true;if(this.inT>=.3)this.offRoute=false;this.wrongT=q.headingDot<-.25&&Math.abs(speed)>3?this.wrongT+dt:0;this.wrongWay=this.wrongT>=1;let notice=null;if((this.offRoute||this.wrongWay)&&time-this.lastNotice>=5){notice=this.wrongWay?'WRONG WAY':'RETURN TO ROUTE';this.lastNotice=time;}return{...q,offRoute:this.offRoute,wrongWay:this.wrongWay,notice,rejoinS:earnedS};}
}
