// One attachment path for solo, remote MP drivers, and the garage preview.
export function bindDriverToCar(driver,model){
  driver.characterRig.bindCar(model);
  return driver;
}
