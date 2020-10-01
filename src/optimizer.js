import { getCurveFromR } from "ffjavascript";
import BigArray from "@iden3/bigarray";
import buildThreadManager from "./threadman.js";

function MakeQuerablePromise(promise) {
    // Don't modify any promise that has been already modified.
    if (promise.isResolved) return promise;

    // Set initial state
    var isPending = true;
    var isRejected = false;
    var isFulfilled = false;

    // Observe the promise, saving the fulfillment in a closure scope.
    var result = promise.then(
        function(v) {
            isFulfilled = true;
            isPending = false;
            return v;
        },
        function(e) {
            isRejected = true;
            isPending = false;
            throw e;
        }
    );

    result.isFulfilled = function() { return isFulfilled; };
    result.isPending = function() { return isPending; };
    result.isRejected = function() { return isRejected; };
    return result;
}


export default async function optimize(cir, logger) {
    const curve = await getCurveFromR(cir.prime, true);
    const tm = await buildThreadManager(curve, false);

    const Fr = curve.Fr;

    if (logger) logger.info(`${curve.name}`);
    if (logger) logger.info(`# of Wires: ${cir.nVars}`);

    const constraints = cir.constraints;
    const vars = new BigArray();

    for (let i=0; i<constraints.length; i++) {
        const c=constraints[i];
        if ((Object.keys(c[0]).length==0)||(Object.keys(c[1]).length==0)) {
            const v = getFreeVar(c[2]);
            if (v>=0) {
                vars[v] = {
                    lc: c[2],
                    v: v,
                    g: v,
                    cid: i
                };
            }
        }
    }

    const varList = vars.getKeys();
    console.log("Total removable: ", varList.length);

    for (let i=0; i<varList.length; i++) {
        const obj = vars[varList[i]];
        const subVars = Object.keys(obj.lc).map( (a) => { return(parseInt(a)); } );
        let g = obj.g;
        while (g<0) g = vars[-g].g;
        for (let k=0; k<subVars.length; k++) {
            if (vars[subVars[k]]) {
                let g2 = vars[subVars[k]].g;
                while (g2<0) g2= vars[-g2]-g;
                if (g2 != g) {
                    vars[subVars[k]].g = -g;
                }
            }
        }
    }

    const groups= new BigArray();
    const groupMap = new BigArray();
    for (let i=0; i<varList.length; i++) {
        if ((logger)&&(i%10000 == 0)) logger.info(`Grouping: ${i}/${varList.length}`);
        const obj = vars[varList[i]];
        let g = obj.g;
        while (g<0) g = vars[-g].g;
        if (typeof groupMap[g] == "undefined") {
            groupMap[g] = groups.length;
            groups.push([]);
        }
        groups[groupMap[g]].push(varList[i]);
    }

    console.log("Groups length: " + groups.length);
    let maxGroupLength =0;
    for (let i=0; i<groups.length; i++) {
        if (groups[i].length>maxGroupLength) {
            maxGroupLength = groups[i].length;
        }
    }
    console.log("maxGroupLength: ", maxGroupLength);

    const issolated = new BigArray();
    const ops = [];
    for (let i=0; i<groups.length; i++) {
        if ((logger)&&(i%1000 == 0)) logger.info(`Issolating groups: ${i}/${groups.length}`);


        const p = isolateGroup(groups[i]).then( (gIssolated) => {
            for (let v in gIssolated) {
                if (issolated[v]) throw ("Variable already issolated");
                issolated[v] = gIssolated[v];
                constraints[vars[v].cid] = null;
            }
            p.fullfilled = true;
        });

        ops.push(p);
        await tm.yield();
        let o=0;
        for (let j=0; j<ops.length; j++) {
            if (!ops[j].fullfilled) {
                ops[o++] = ops[j];
            }
        }
        ops.length = o;
    }

    await Promise.all(ops);

    let o =0;
    const old2new = new BigArray();
    const newMap = new BigArray();
    for (let i=0; i<= cir.nOutputs + cir.nPubInputs; i++) {
        old2new[i] = i;
        newMap[i] = cir.map[i];
    }
    let nNew = cir.nOutputs + cir.nPubInputs +1;
    for (let i=0; i<constraints.length; i++) {
        if ((logger)&&(i%1000 == 0)) logger.info(`Substituting constraints: ${i}/${constraints.length}`);
        if (constraints[i]) {
            const c = substituteConstraint(constraints[i], issolated);
            remapC(c);
            constraints[o] = c;
            o++;
        }
    }
    constraints.length = o;

    const newCir = {};
    newCir.n8 = cir.n8;
    newCir.prime = cir.prime;
    newCir.curve = cir.curve;

    newCir.nVars = nNew;
    newCir.nOutputs = cir.nOutputs;
    newCir.nPubInputs = cir.nPubInputs;
    newCir.nPrvInputs = cir.nPrvInputs;
    newCir.nLabels = cir.nLabels;
    newCir.nConstraints = constraints.length;

    newCir.constraints = constraints;
    newCir.map = newMap;

    console.log (`Final #Constraints: ${constraints.length}`);

    return newCir;

    function remapLC(lc) {
        const r = {};
        for (let v in lc) {
            if (!old2new[v]) {
                old2new[v] = nNew;
                newMap[nNew] = cir.map[v];
                nNew ++;
            }
            r[old2new[v]] = lc[v];
        }
        return r;
    }

    function remapC(c) {
        return [
            remapLC(c[0]),
            remapLC(c[1]),
            remapLC(c[2]),
        ];
    }

    function getFreeVar(c) {
        const keys = Object.keys(c);
        for (let i=0; i<keys.length; i++) {
            const v = parseInt(keys[i]);
            if ((v > (cir.nOutputs + cir.nPubInputs))&&(!vars[v])) return v;
        }
        return -1;
    }
/*
    function isolateGroup(group) {
        const mapVar2groupIdx = {};
        const vars2 = [];
        for (let i=0; i<group.length; i++) {
            mapVar2groupIdx[group[i]] = i;
            vars2[i] = vars[group[i]].lc;
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
            const lc = vars2[i].lc;
            let is = isolateLCn(lc, group[i]);
            if (is) {
                is = substituteLC(is, issolated);
                issolated[v] = is;
            }
        }

        return issolated;

    }
*/

    function isolateGroup(group) {
        const vars2 = [];
        for (let i=0; i<group.length; i++) {
            vars2[i] = vars[group[i]].lc;
        }

        return tm.queueAction([group, vars2]);
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

    function substituteConstraint(c, vars) {
        return [
            substituteLC(c[0], vars),
            substituteLC(c[1], vars),
            substituteLC(c[2], vars),
        ];
    }


}

