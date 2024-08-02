import { Mutex } from "async-mutex";
import { CronJob } from "cron";

import { User } from "../db/user";

export class LeavingService {
    private readonly leavingMutex: Mutex;
    private readonly cronjob: CronJob;
    private readonly expirationDelay: number;
    private leavingAttempts: Map<number, number>;

    constructor(expirationDelay: number) {
        this.leavingMutex = new Mutex();
        this.expirationDelay = expirationDelay;
        this.leavingAttempts = new Map<number, number>;

        console.log("LeavingService: initialised and started");
        this.cronjob = new CronJob('*/2 * * * * *', () => {
            this.removeOldAttempts();
        }, null, true, "Europe/London", null, true);

        process.once('SIGINT', () => { this.stop(); });
        process.once('SIGTERM', () => { this.stop(); });
    }

    async registerLeavingIntention(user: User) {
        await this.leavingMutex.acquire();
        this.leavingAttempts.set(user.id, performance.now());
        this.leavingMutex.release();
    }

    async removeUserLeavingIntention(user: User) {
        await this.leavingMutex.acquire();
        this.leavingAttempts.delete(user.id);
        this.leavingMutex.release();
    }

    async didUserAlreadyRegisteredIntention(user: User): Promise<boolean> {
        await this.leavingMutex.acquire();
        const currentTime = performance.now();
        const userAlreadyRegistered = this.leavingAttempts.has(user.id) && (currentTime - this.leavingAttempts.get(user.id) < this.expirationDelay);
        this.leavingMutex.release();
        return userAlreadyRegistered
    }

    private async removeOldAttempts() {
        await this.leavingMutex.acquire();
        const currentTime = performance.now();

        for (let [userId, registrationTime] of this.leavingAttempts.entries())
            if (currentTime - registrationTime > this.expirationDelay)
                this.leavingAttempts.delete(userId);

        this.leavingMutex.release();
    }

    private stop() {
        this.cronjob.stop();
        console.log("LeavingService: stopped");
    }

}