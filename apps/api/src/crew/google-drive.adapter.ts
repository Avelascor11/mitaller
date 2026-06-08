import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createSign } from 'crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE = 'https://www.googleapis.com/drive/v3';

/** Minimal Google Drive client via service-account JWT (no external deps). */
@Injectable()
export class GoogleDriveAdapter {
  private readonly logger = new Logger(GoogleDriveAdapter.name);
  private cachedToken: { token: string; exp: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  get configured() {
    return Boolean(this.clientEmail && this.privateKey && this.parentId);
  }
  private get clientEmail() { return this.config.get<string>('GOOGLE_SA_CLIENT_EMAIL') ?? ''; }
  private get privateKey() { return (this.config.get<string>('GOOGLE_SA_PRIVATE_KEY') ?? '').replace(/\\n/g, '\n'); }
  get parentId() { return this.config.get<string>('GDRIVE_CREW_PARENT_ID') ?? ''; }

  private async accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cachedToken && this.cachedToken.exp > now + 60) return this.cachedToken.token;

    const header = this.b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = this.b64url(JSON.stringify({
      iss: this.clientEmail,
      scope: 'https://www.googleapis.com/auth/drive',
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600
    }));
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claim}`);
    const signature = signer.sign(this.privateKey).toString('base64url');
    const assertion = `${header}.${claim}.${signature}`;

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
    });
    const json = await res.json();
    if (!res.ok) {
      this.logger.error(`Drive token error: ${JSON.stringify(json)}`);
      throw new Error(json.error_description ?? 'Drive auth failed');
    }
    this.cachedToken = { token: json.access_token, exp: now + Number(json.expires_in ?? 3600) };
    return json.access_token;
  }

  /** Create a per-influencer subfolder under the crew parent; returns its shareable link. */
  async createInfluencerFolder(folderName: string): Promise<string | null> {
    if (!this.configured) return null;
    try {
      const token = await this.accessToken();
      const createRes = await fetch(`${DRIVE}/files?supportsAllDrives=true`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [this.parentId]
        })
      });
      const created = await createRes.json();
      if (!createRes.ok) throw new Error(JSON.stringify(created));
      const id = created.id as string;
      // Anyone with the link can add files (writer).
      await fetch(`${DRIVE}/files/${id}/permissions?supportsAllDrives=true`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'writer', type: 'anyone' })
      }).catch(() => undefined);
      return `https://drive.google.com/drive/folders/${id}`;
    } catch (e) {
      this.logger.warn(`Drive folder create failed for "${folderName}": ${(e as Error).message}`);
      return null;
    }
  }

  private b64url(s: string) {
    return Buffer.from(s).toString('base64url');
  }
}
