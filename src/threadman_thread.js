/* global WebAssembly */

export default function thread(self, ff) {

    let curve;

    if (self) {
        self.onmessage = function(e) {
            let data;
            if (e.data) {
                data = e.data;
            } else {
                data = e;
            }

            if (data[0].cmd == "INIT") {
                init(data[0]).then(function() {
                    self.postMessage(data.result);
                });
            } else if (data[0].cmd == "TERMINATE") {
                process.exit();
            } else {
                const res = runTask(data);
                self.postMessage(res);
            }
        };
    }

    async function init(data) {

        curve = await ff.getCurveFromR(data.r, true);
    }


    function runTask(task) {
        if (task[0].cmd == "INIT") {
            return init(task[0]);
        }

        return isolateGroup(task[0], task[1]);
    }

    function isolateGroup(group, vars2) {

        const Fr = curve.Fr;
        const mapVar2groupIdx = {};
        for (let i=0; i<group.length; i++) {
            mapVar2groupIdx[group[i]] = i;
        }

        let nGroup = group.length;

        while (nGroup>0) {

            const otherNonZero = new Array(nGroup);
            for (let i=0; i< nGroup; i++) otherNonZero[i] = 0;
            for (let i=0; i<nGroup; i++) {
                for ( let v2 in vars2[i]) {
                    if (v2 in mapVar2groupIdx) {
                        otherNonZero[mapVar2groupIdx[v2]]++;
                    }
                }
            }

            const v1Idx  = otherNonZero.reduce(function(lowest, next, index) {
                return (next < otherNonZero[lowest]) ? index : lowest;
            }, 0);

            const v1 = group[v1Idx];
            const v2Idxs = [];
            for (let j=0; j<nGroup; j++) {
                if (v1Idx==j) continue;
                if ( vars2[j][v1] ) v2Idxs.push(j);
            }

            let lc1 = vars2[v1Idx];
            if (lc1[v1]) {
                normalizeLC(lc1, v1);
                vars2[v1Idx] = lc1;

                for (let i=0; i<v2Idxs.length; i++) {
                    const v2Idx = v2Idxs[i];
                    let lc2 = vars2[v2Idx];
                    lc2 = reduceLC(lc1, lc2, v1);
                    vars2[v2Idx] = lc2;
                }
            } else {
                delete vars2[v1Idx];
            }

            const lastv = group[nGroup -1];

            mapVar2groupIdx[lastv] = v1Idx;
            mapVar2groupIdx[v1] = nGroup-1;

            const tmp = vars2[v1Idx];
            vars2[v1Idx] = vars2[nGroup -1];
            vars2[nGroup -1] = tmp;

            group[v1Idx] = lastv;
            group[nGroup -1] = v1;

            nGroup--;

        }

        const issolated = {};
        for (let i=0; i<group.length; i++) {
            const v = group[i];
            if (!vars2[i]) continue;
            const lc = vars2[i];
            let is = isolateLCn(lc, group[i]);
            if (is) {
                is = substituteLC(is, issolated);
                issolated[v] = is;
            }
        }

        return issolated;


        function normalizeLC(lc, v) {
            if (!lc[v]) throw new Error("Normalizing a constraint with the zero variable");
            const inv = Fr.inv(lc[v]);
            for (let v2 in lc) {
                lc[v2] = Fr.mul(lc[v2], inv);
            }
        }

        function reduceLC(lc1n, lc2, v) {
            const r = {};
            const m = Fr.neg(lc2[v]);
            for (let v1 in lc1n) {
                r[v1] = Fr.mul(lc1n[v1], m);
            }
            for (let v2 in lc2) {
                if (r[v2]) {
                    r[v2] = Fr.add(r[v2], lc2[v2]);
                    if (Fr.isZero(r[v2])) delete r[v2];
                } else {
                    r[v2] = lc2[v2];
                }
            }
            return r;
        }

        function isolateLCn(lcn, v) {
            const r = {};
            for (let v1 in lcn) {
                if (v1 != v) {
                    r[v1] = Fr.neg(lcn[v1]);
                }
            }
            return r;
        }


        function substituteLC(lc, vars) {
            const r = {};
            for (let v1 in lc) {
                if (vars[v1]) {
                    for (let v2 in vars[v1]) {
                        if (r[v2]) {
                            r[v2] = Fr.add(r[v2], Fr.mul(lc[v1], vars[v1][v2]));
                            if (Fr.isZero(r[v2])) delete r[v2];
                        } else {
                            r[v2] = Fr.mul(lc[v1], vars[v1][v2]);
                        }
                    }
                } else {
                    if (r[v1]) {
                        r[v1] = Fr.add(r[v1], lc[v1]);
                        if (Fr.isZero(r[v1])) delete r[v1];
                    } else {
                        r[v1] = lc[v1];
                    }
                }
            }
            return r;
        }

    }


    return runTask;
}
