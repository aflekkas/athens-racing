import './physics-test/register.mjs';
import {catalogue,flatRoute} from './physics-test/powertrain.mjs';
import {Vehicle} from '../src/physics.js';
const spec=catalogue().find(c=>c.id==='aventador_svj');
const v=new Vehicle(spec,flatRoute);let t100=null;for(let i=0;i<7200;i++){v.update(1/60,{throttle:1,brake:0,steer:0});if(t100===null&&v.kmh>=100)t100=(i+1)/60;}console.log({t100,top:v.kmh});
