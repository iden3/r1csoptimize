/*
    Copyright 2019 0KIMS association.

    This file is part of wasmsnark (Web Assembly zkSnark Prover).

    wasmsnark is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    wasmsnark is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with wasmsnark. If not, see <https://www.gnu.org/licenses/>.
*/


import thread from "./threadman_thread.js";
import os from "os";
import path from "path";

import NodeWorker_mod from "worker_threads";

import  * as ffjavascript from "ffjavascript";


const __dirname = path.dirname(new URL(import.meta.url).pathname);


class Deferred {
    constructor() {
        this.promise = new Promise((resolve, reject)=> {
            this.reject = reject;
            this.resolve = resolve;
        });
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


export default async function buildThreadManager(curve, singleThread) {
    const tm = new ThreadManager();

    tm.singleThread = singleThread;

    if (singleThread) {
        tm.taskManager = thread(null, ffjavascript);
        await tm.taskManager([{
            cmd: "INIT",
            r: curve.r
        }]);
        tm.concurrency  = 1;
    } else {
        tm.workers = [];
        tm.pendingDeferreds = [];
        tm.working = [];

        let concurrency;
        concurrency = os.cpus().length;
        if (concurrency>64) concurrency = 64;
        tm.concurrency = concurrency;

        for (let i = 0; i<concurrency; i++) {

            tm.workers[i] = new NodeWorker_mod.Worker("(" + thread.toString()+ ")(require('worker_threads').parentPort, require('ffjavascript'));", {eval: true});

            // tm.workers[i] = new NodeWorker_mod.Worker(path.join(__dirname, "./threadman_thread.js"));

            tm.workers[i].on("message", getOnMsg(i));

            tm.working[i]=false;
        }

        const initPromises = [];
        for (let i=0; i<tm.workers.length;i++) {
            initPromises.push(tm.postAction(i, [{
                cmd: "INIT",
                r: curve.r
            }]));
        }

        await Promise.all(initPromises);
    }
    return tm;

    function getOnMsg(i) {
        return function(e) {
            let data;
            if ((e)&&(e.data)) {
                data = e.data;
            } else {
                data = e;
            }

            tm.working[i]=false;
            tm.pendingDeferreds[i].resolve(data);
            tm.processWorks();
            if (tm.actionQueue.length< tm.concurrency*2) {
                while (tm.pendingYields.length>0 ) {
                    const d = tm.pendingYields.pop();
                    d.resolve();
                }
            }
        };
    }

}

class ThreadManager {
    constructor() {
        this.actionQueue = [];
        this.pendingYields = [];
    }

    postAction(workerId, e, transfers, _deferred) {
        if (this.working[workerId]) {
            throw new Error("Posting a job to a working worker");
        }
        this.working[workerId] = true;

        this.pendingDeferreds[workerId] = _deferred ? _deferred : new Deferred();
        this.workers[workerId].postMessage(e, transfers);

        return this.pendingDeferreds[workerId].promise;
    }

    processWorks() {
        const self = this;
        for (let i=0; (i<self.workers.length)&&(self.actionQueue.length > 0); i++) {
            if (this.working[i] == false) {
                const work = self.actionQueue.shift();
                self.postAction(i, work.data, work.transfers, work.deferred);
            }
        }
    }

    queueAction(actionData, transfers) {
        const d = new Deferred();

        if (this.singleThread) {
            const res = this.taskManager(actionData);
            d.resolve(res);
        } else {
            this.actionQueue.push({
                data: actionData,
                transfers: transfers,
                deferred: d
            });
            this.processWorks();
        }
        return d.promise;
    }

    yield() {
        const self = this;
        if (self.actionQueue.length<self.concurrency*2) return;
        const d = new Deferred();
        self.pendingYields.push(d);
        return d.promise;
    }

    async terminate() {
        for (let i=0; i<this.workers.length; i++) {
            this.workers[i].postMessage([{cmd: "TERMINATE"}]);
        }
        await sleep(200);
    }

}

