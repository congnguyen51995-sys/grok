const fs = require('fs').promises;
const path = require('path');

class DatabaseService {
  constructor(userDataPath) {
    this.dbPath = path.join(userDataPath, 'grok-studio.json');
    this.data = { jobs: [], settings: { concurrency: '1' } };
  }

  async init() {
    try {
      const content = await fs.readFile(this.dbPath, 'utf8');
      this.data = JSON.parse(content);
    } catch {
      this.data = { jobs: [], settings: { concurrency: '1', default_aspect_ratio: '1:1', default_duration: '6' } };
      await this.save();
    }
    console.log('JSON DB ready');
  }

  async save() {
    await fs.writeFile(this.dbPath, JSON.stringify(this.data, null, 2));
  }

  async createJob(jobData) {
    const id = Date.now();
    const job = {
      id, prompt: jobData.prompt || '', mode: jobData.mode || 'TEXT_TO_IMAGE',
      status: 'PENDING', progress: 0, aspect_ratio: jobData.aspectRatio || '1:1',
      resolution: jobData.quality || '720p',
      duration: jobData.duration || 6, image_file: jobData.imageFile || null,
      profile_id: jobData.profileId || null, profile_name: jobData.profileName || null,
      file_index: jobData.fileIndex ?? null,
      local_file_path: null, grok_url: null,
      error_message: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    };
    this.data.jobs.push(job);
    await this.save();
    return id;
  }

  async getAllJobs() {
    return this.data.jobs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  async getJobById(id) {
    return this.data.jobs.find(j => j.id === id);
  }

  async updateJobStatus(id, status, progress = null) {
    const job = this.data.jobs.find(j => j.id === id);
    if (job) { job.status = status; if (progress !== null) job.progress = progress; job.updated_at = new Date().toISOString(); await this.save(); }
  }

  async updateJobComplete(id, filePath, grokUrl) {
    const job = this.data.jobs.find(j => j.id === id);
    if (job) { job.local_file_path = filePath; job.grok_url = grokUrl; job.status = 'COMPLETED'; job.progress = 100; job.updated_at = new Date().toISOString(); await this.save(); }
  }

  async updateJobError(id, errorMessage) {
    const job = this.data.jobs.find(j => j.id === id);
    if (job) { job.status = 'FAILED'; job.error_message = errorMessage; job.updated_at = new Date().toISOString(); await this.save(); }
  }

  async deleteJob(id) {
    this.data.jobs = this.data.jobs.filter(j => j.id !== id);
    await this.save();
  }

  async countByStatus(status) {
    return this.data.jobs.filter(j => j.status === status).length;
  }

  async getSetting(key, defaultValue = null) {
    return this.data.settings[key] ?? defaultValue;
  }

  async setSetting(key, value) {
    this.data.settings[key] = value;
    await this.save();
  }

  async retryJob(id) {
    const job = this.data.jobs.find(j => j.id === id);
    if (job) {
      job.status = 'PENDING'; job.progress = 0;
      job.error_message = null; job.local_file_path = null; job.grok_url = null;
      job.updated_at = new Date().toISOString();
      await this.save();
    }
    return job;
  }

  close() {} // no-op — JSON storage has no connection to close
}

module.exports = { DatabaseService };
