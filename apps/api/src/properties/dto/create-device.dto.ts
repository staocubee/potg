import { IsIn, IsOptional, IsString } from 'class-validator';

const DEVICE_TYPES = ['smart_meter', 'water_meter', 'security_camera', 'smart_lock', 'solar_inverter'] as const;

// Module 22's device registry — see PropertyDevice's own schema comment
// for why this is a registry of intent to connect, not a live telemetry
// feed: no real adapter exists for any of these device types yet, so
// `status` can only ever be set to "not_connected" by this pass.
export class CreateDeviceDto {
  @IsIn(DEVICE_TYPES)
  deviceType!: (typeof DEVICE_TYPES)[number];

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  provider?: string;
}
