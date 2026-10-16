import * as THREE from 'three';
import { assertWorldBudget } from './world-art-direction.js';
export function squarePost(width,height,depth=width,category='barrierPost') { return assertWorldBudget(category,new THREE.BoxGeometry(width,height,depth)); }
export function signFace(radius) { return assertWorldBudget('sign',new THREE.CircleGeometry(radius,8)); }
