/**
 * Quản lý hàng đợi jobs sử dụng p-queue (ESM dynamic import)
 */
class QueueManager {
  constructor(options) {
    this.db = options.db;
    this.playwrightEngine = options.playwrightEngine;
    this.queue = null;
    this.isRunning = true;
    this.concurrency = options.concurrency || 1;
  }

  async init() {
    const { default: PQueue } = await import('p-queue');
    this.queue = new PQueue({ 
      concurrency: this.concurrency,
      autoStart: true
    });
    console.log(`Queue initialized with concurrency: ${this.queue.concurrency}`);
  }

  /**
   * Thay đổi số lượng chạy song song
   */
  setConcurrency(n) {
    const oldConcurrency = this.queue.concurrency;
    this.queue.concurrency = Math.max(1, n);
    console.log(`Concurrency changed: ${oldConcurrency} -> ${this.queue.concurrency}`);
  }

  /**
   * Thêm job vào hàng đợi
   */
  addJob(job) {
    console.log(`Adding job ${job.id} to queue`);

    this.queue.add(async () => {
      if (!this.isRunning) {
        console.log(`Queue paused, skipping job ${job.id}`);
        return;
      }

      try {
        // Await the DB update AND notify renderer so status shows RUNNING immediately
        await this.db.updateJobStatus(job.id, 'RUNNING', 0);
        this.playwrightEngine.onProgress(job.id, 0);

        console.log(`Starting job ${job.id}: ${job.prompt?.substring(0, 50)}...`);

        await this.playwrightEngine.executeJobViaChrome(job);

        console.log(`Job ${job.id} completed`);

      } catch (error) {
        console.error(`Job ${job.id} failed:`, error.message);
        await this.db.updateJobError(job.id, error.message);
      }
    });
  }

  /**
   * Thêm nhiều jobs cùng lúc
   */
  addJobs(jobs) {
    for (const job of jobs) {
      this.addJob(job);
    }
  }

  /**
   * Tạm dừng queue
   */
  pause() {
    this.queue.pause();
    this.isRunning = false;
    console.log('Queue paused');
  }

  /**
   * Tiếp tục queue
   */
  resume() {
    this.queue.start();
    this.isRunning = true;
    console.log('Queue resumed');
  }

  /**
   * Xóa tất cả jobs đang chờ
   */
  clear() {
    this.queue.clear();
    console.log('Queue cleared');
  }

  /**
   * Lấy thống kê queue
   */
  getStats() {
    return {
      pending: this.queue.pending,
      running: this.activeJobs?.size || 0,
      isPaused: this.queue.isPaused,
      concurrency: this.queue.concurrency
    };
  }

  /**
   * Dừng hoàn toàn và đóng browser
   */
  async stop() {
    this.pause();
    this.clear();
    if (this.playwrightEngine && typeof this.playwrightEngine.close === 'function') {
      await this.playwrightEngine.close();
    }
    console.log('Queue manager stopped');
  }
}

module.exports = { QueueManager };
