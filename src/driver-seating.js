// One attachment path for solo, remote MP drivers, and the garage preview.
export function bindDriverToCar(driver,model){
  driver.characterRig.bindCar(model);
  driver.root.visible=!model.spec?.twoWheeler; // Fleet bikes already include their seated rider.
  return driver;
}
