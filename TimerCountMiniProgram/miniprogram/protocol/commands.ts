export enum CommandId {
  StartDetection = 0x01,
  StopDetection = 0x02,
  GetRaceState = 0x03,
  RaceState = 0x04,
  DefineEpc = 0x10,
  GetAllAthletes = 0x11,
  AthleteInfo = 0x12,
  AthleteTransferState = 0x13,
  OrdinaryEpcDetected = 0x14,
  CommandResult = 0xf0,
}
