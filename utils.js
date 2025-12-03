export function getDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.z - p2.z, 2));
}

// Check if point P is strictly within a rectangle defined by Center C, Width W, Height H, and rotation Angle
export function isPointOnOBB(point, center, width, height, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    // Translate point to local space
    const dx = point.x - center.x;
    const dz = point.z - center.z;

    // Rotate point to axis aligned
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;

    return Math.abs(localX) <= width / 2 && Math.abs(localZ) <= height / 2;
}

// SAT detection for OBB overlap (ignoring Y axis)
export function boxIntersectsBox(c1, w1, h1, a1, c2, w2, h2, a2) {
    // Convert boxes to vertices
    const getVerts = (c, w, h, a) => {
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const dx1 = (w/2) * cos - (h/2) * sin;
        const dz1 = (w/2) * sin + (h/2) * cos;
        const dx2 = (w/2) * cos + (h/2) * sin;
        const dz2 = (w/2) * sin - (h/2) * cos;
        return [
            { x: c.x + dx1, z: c.z + dz1 },
            { x: c.x + dx2, z: c.z + dz2 },
            { x: c.x - dx1, z: c.z - dz1 },
            { x: c.x - dx2, z: c.z - dz2 }
        ];
    };

    const verts1 = getVerts(c1, w1, h1, a1);
    const verts2 = getVerts(c2, w2, h2, a2);

    // Axes to test: normals of box1 and box2
    const axes = [
        { x: Math.cos(a1), z: Math.sin(a1) },
        { x: -Math.sin(a1), z: Math.cos(a1) },
        { x: Math.cos(a2), z: Math.sin(a2) },
        { x: -Math.sin(a2), z: Math.cos(a2) }
    ];

    for (const axis of axes) {
        let min1 = Infinity, max1 = -Infinity;
        let min2 = Infinity, max2 = -Infinity;

        for (const v of verts1) {
            const proj = v.x * axis.x + v.z * axis.z;
            min1 = Math.min(min1, proj);
            max1 = Math.max(max1, proj);
        }
        for (const v of verts2) {
            const proj = v.x * axis.x + v.z * axis.z;
            min2 = Math.min(min2, proj);
            max2 = Math.max(max2, proj);
        }

        if (max1 < min2 || max2 < min1) return false; // Separating axis found
    }

    return true; // No separating axis found
}