import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// The server-side half of the "live view" feature — same "plain fetch,
// no SDK, isConfigured gate" shape OpenAiImageService/PaystackService
// already use. Turns a property's own free-text address into real
// coordinates so PropertiesService.create/updateProperty can finally
// populate Property.latitude/longitude, fields that have existed in
// this schema since Module 1 with a full DTO/validation pipeline behind
// them (CreatePropertyDto/UpdatePropertyDto both already accept them)
// but no caller anywhere — client or server — has ever actually set
// them until now.
@Injectable()
export class GoogleGeocodingService {
  private readonly logger = new Logger(GoogleGeocodingService.name);
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('GOOGLE_MAPS_API_KEY', '');
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  // Never throws — a property is real and useful whether or not it's
  // been located yet (same "the platform still works" reasoning
  // indexEmbedding's own fire-and-forget call already applies to search),
  // so a bad address, no API key, or a Google API error all just mean
  // "not located this time," logged, not a failed property save.
  async geocode(address: string): Promise<{ latitude: number; longitude: number } | null> {
    if (!this.isConfigured || !address.trim()) return null;
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${this.apiKey}`;
      const res = await fetch(url);
      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        error_message?: string;
        results?: { geometry?: { location?: { lat: number; lng: number } } }[];
      };
      const location = data.results?.[0]?.geometry?.location;
      if (data.status !== 'OK' || !location) {
        this.logger.warn(
          `Geocoding "${address}" returned ${data.status ?? 'no response'}${data.error_message ? `: ${data.error_message}` : ''}`,
        );
        return null;
      }
      return { latitude: location.lat, longitude: location.lng };
    } catch (err) {
      this.logger.warn(`Geocoding "${address}" threw: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }
}
