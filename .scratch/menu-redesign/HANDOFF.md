Account integration: the shared C.statusBar now emits a native, tabbable button with data-act="account". Menu.activate opens screen "account" with push=true so Back restores the prior screen. Fill Menu.r_account(), or supply h.account(menu) returning markup built with C.screen(). The placeholder has no account/network dependency. Keep this route name and button action stable.

Design references studied before implementation:
- Forza Horizon 5 title / menu: https://forums.forza.net/t/pc-game-crashing-with-invalid-profile-message/782438 and https://forums.forza.net/t/cant-select-map-from-main-horizon-mexico-menu/801337
- NFS Unbound designer's garage interface: https://prattatatat.com/need-for-speed
- Gran Turismo 7 manual: https://www.gran-turismo.com/gb/gt7/manual/gtworld/03

The selected car is shown as real catalogue data in Garage and READY TO DRIVE. The hero is explicitly a featured Carrera; it does not pretend to be the selected car. It is a pre-rendered image, not a live world. The backdrop is still an abstract studio/coast composition; a real Riviera cinematic would give it more place and life. This is the main visual limitation.
