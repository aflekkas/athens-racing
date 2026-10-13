// Minimal stand-in for the parts of three.js that physics.js / util.js touch at load time.
export class Vector3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
export class Quaternion {}
export class Euler {}
export class Matrix4 {}
export class Matrix3 {}
export class Color {}
