// g++ -shared -fPIC -O2 -I/usr/include/node thread-clock.cc -o /tmp/terrain-thread-clock.node
#include <node_api.h>
#include <time.h>
static napi_value Now(napi_env env,napi_callback_info info) {
  timespec t; clock_gettime(CLOCK_THREAD_CPUTIME_ID,&t);
  napi_value result; napi_create_double(env,t.tv_sec*1e6+t.tv_nsec/1e3,&result); return result;
}
static napi_value Init(napi_env env,napi_value exports) {
  napi_value fn; napi_create_function(env,"now",NAPI_AUTO_LENGTH,Now,nullptr,&fn);
  napi_set_named_property(env,exports,"now",fn); return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,Init)
