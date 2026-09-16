require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// In-memory OTP store
// { mobile: { otp, expiresAt, attempts } }
const otpStore = new Map();


// ============================================================
// FACE MATCHING FUNCTION
// ============================================================

// Face-api.js produces a 128-dimensional face descriptor.
// Euclidean distance is used to compare two descriptors.
//
// Smaller distance = more similar faces.
//
// 0.6 is a commonly used face-api.js matching threshold.
function euclideanDistance(descriptor1, descriptor2) {

    if (
        !Array.isArray(descriptor1) ||
        !Array.isArray(descriptor2) ||
        descriptor1.length !== 128 ||
        descriptor2.length !== 128
    ) {
        return Infinity;
    }

    // Make sure every value is a valid number.
    if (
        !descriptor1.every(value => Number.isFinite(value)) ||
        !descriptor2.every(value => Number.isFinite(value))
    ) {
        return Infinity;
    }

    let sum = 0;

    for (let i = 0; i < descriptor1.length; i++) {

        const difference =
            descriptor1[i] - descriptor2[i];

        sum += difference * difference;
    }

    const distance = Math.sqrt(sum);

    // Never allow NaN or Infinity to be accepted.
    if (!Number.isFinite(distance)) {
        return Infinity;
    }

    return distance;
}


// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/', (req, res) => {

    res.send(
        'Online Voting System Backend Running Successfully (PostgreSQL/Neon)'
    );

});


// ============================================================
// SEND OTP
// ============================================================

app.post('/send-otp', (req, res) => {

    const { mobile } = req.body;

    if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) {

        return res.status(400).json({
            success: false,
            message: 'Invalid mobile number'
        });

    }

    const otp = Math.floor(
        100000 + Math.random() * 900000
    ).toString();

    const expiresAt =
        Date.now() + 5 * 60 * 1000;

    otpStore.set(mobile, {
        otp,
        expiresAt,
        attempts: 0
    });

    console.log(
        `[OTP] Generated for ${mobile}: ${otp}`
    );

    res.json({
        success: true,
        message: `OTP sent to ${mobile}`,
        testOtp: otp
    });

});


// ============================================================
// VERIFY OTP
// ============================================================

app.post('/verify-otp', (req, res) => {

    const { mobile, otp } = req.body;

    const record = otpStore.get(mobile);

    if (!record) {

        return res.status(400).json({
            success: false,
            message:
                'No OTP found. Please request again.'
        });

    }

    if (Date.now() > record.expiresAt) {

        otpStore.delete(mobile);

        return res.status(400).json({
            success: false,
            message:
                'OTP expired. Please request again.'
        });

    }

    record.attempts += 1;

    if (record.attempts > 5) {

        otpStore.delete(mobile);

        return res.status(400).json({
            success: false,
            message:
                'Too many attempts. Please request again.'
        });

    }

    if (record.otp !== otp) {

        return res.status(400).json({
            success: false,
            message:
                'Incorrect OTP'
        });

    }

    otpStore.delete(mobile);

    res.json({
        success: true,
        message:
            'Mobile verified successfully'
    });

});


// ============================================================
// REGISTER
// ============================================================

app.post('/register', async (req, res) => {

    try {

        const {
            name,
            email,
            password,
            aadhaar,
            dob,
            mobile,
            faceDescriptor
        } = req.body;


        if (
            !name ||
            !email ||
            !password ||
            !aadhaar ||
            !dob ||
            !mobile
        ) {

            return res.status(400).json({
                success: false,
                message:
                    'All fields are required'
            });

        }


        const existing = await db.query(
            'SELECT id FROM users WHERE email = $1 OR aadhaar = $2 OR mobile = $3',
            [email, aadhaar, mobile]
        );


        if (existing.rows.length > 0) {

            return res.status(400).json({
                success: false,
                message:
                    'User already registered with this email, Aadhaar, or mobile'
            });

        }


        const result = await db.query(
            `INSERT INTO users
            (
                name,
                email,
                password,
                aadhaar,
                dob,
                mobile,
                mobile_verified,
                face_descriptor
            )
            VALUES
            (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                TRUE,
                $7
            )
            RETURNING id`,
            [
                name,
                email,
                password,
                aadhaar,
                dob,
                mobile,
                JSON.stringify(faceDescriptor || [])
            ]
        );


        res.json({
            success: true,
            message:
                'Registration successful',
            userId:
                result.rows[0].id
        });

    } catch (error) {

        console.error(
            'Register error:',
            error
        );

        res.status(500).json({
            success: false,
            message:
                'Registration failed',
            error:
                error.message
        });

    }

});


// ============================================================
// LOGIN
// ============================================================

app.post('/login', async (req, res) => {

    try {

        const {
            email,
            password
        } = req.body;


        const result = await db.query(
            `SELECT
                id,
                name,
                email,
                voted
             FROM users
             WHERE email = $1
             AND password = $2`,
            [email, password]
        );


        if (result.rows.length === 0) {

            return res.status(401).json({
                success: false,
                message:
                    'Invalid email or password'
            });

        }


        res.json({
            success: true,
            message:
                'Login successful',
            user:
                result.rows[0]
        });

    } catch (error) {

        console.error(
            'Login error:',
            error
        );

        res.status(500).json({
            success: false,
            message:
                'Login failed',
            error:
                error.message
        });

    }

});


// ============================================================
// VERIFY FACE
// ============================================================

app.post('/verify-face', async (req, res) => {

    try {

        const {
            userId,
            face_descriptor
        } = req.body;


        // --------------------------------------------------------
        // STEP 1: Check input
        // --------------------------------------------------------

        if (!userId) {

            return res.status(400).json({
                success: false,
                message:
                    'User ID required'
            });

        }


        if (
            !Array.isArray(face_descriptor) ||
            face_descriptor.length !== 128
        ) {

            return res.status(400).json({
                success: false,
                message:
                    'Invalid face descriptor'
            });

        }


        // Make sure live descriptor contains valid numbers.
        if (
            !face_descriptor.every(
                value => Number.isFinite(value)
            )
        ) {

            return res.status(400).json({
                success: false,
                message:
                    'Invalid face descriptor values'
            });

        }


        // --------------------------------------------------------
        // STEP 2: Get registered voter from database
        // --------------------------------------------------------

        const result = await db.query(
            `SELECT
                id,
                name,
                face_descriptor,
                voted
             FROM users
             WHERE id = $1`,
            [userId]
        );


        if (result.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message:
                    'User not found'
            });

        }


        const user = result.rows[0];


        // --------------------------------------------------------
        // STEP 3: Check registered face descriptor
        // --------------------------------------------------------

        if (!user.face_descriptor) {

            return res.status(400).json({
                success: false,
                message:
                    'No registered face found for this voter'
            });

        }


        let registeredDescriptor;


        try {

            if (
                typeof user.face_descriptor === 'string'
            ) {

                registeredDescriptor =
                    JSON.parse(
                        user.face_descriptor
                    );

            } else {

                registeredDescriptor =
                    user.face_descriptor;

            }

        } catch (parseError) {

            console.error(
                'Face descriptor parsing error:',
                parseError
            );

            return res.status(500).json({
                success: false,
                message:
                    'Registered face data is invalid'
            });

        }


        // --------------------------------------------------------
        // STEP 4: Validate registered descriptor
        // --------------------------------------------------------

        if (
            !Array.isArray(registeredDescriptor) ||
            registeredDescriptor.length !== 128
        ) {

            return res.status(400).json({
                success: false,
                message:
                    'Registered face data is missing or invalid'
            });

        }


        // Make sure registered descriptor contains valid numbers.
        if (
            !registeredDescriptor.every(
                value => Number.isFinite(value)
            )
        ) {

            return res.status(400).json({
                success: false,
                message:
                    'Registered face data contains invalid values'
            });

        }


        // --------------------------------------------------------
        // STEP 5: Compare live face with registered face
        // --------------------------------------------------------

        const distance =
            euclideanDistance(
                face_descriptor,
                registeredDescriptor
            );


        const FACE_MATCH_THRESHOLD = 0.6;


        console.log(
            `[FACE VERIFY] User ${userId} | Distance: ${distance}`
        );


        // --------------------------------------------------------
        // IMPORTANT:
        // Reject if distance is invalid OR greater than threshold.
        // --------------------------------------------------------

        if (
            !Number.isFinite(distance) ||
            distance > FACE_MATCH_THRESHOLD
        ) {

            console.log(
                `[FACE VERIFY] User ${userId} - FACE NOT MATCHED`
            );

            return res.status(401).json({
                success: false,
                message:
                    'Face does not match the registered voter'
            });

        }


        console.log(
            `[FACE VERIFY] User ${userId} - FACE MATCHED`
        );


        // --------------------------------------------------------
        // STEP 6: Check whether voter already voted
        // --------------------------------------------------------

        if (user.voted === true) {

            console.log(
                `[VOTE CHECK] User ${userId} has already voted`
            );

            return res.status(409).json({
                success: false,
                message:
                    'Face verified, but you have already voted'
            });

        }


        // --------------------------------------------------------
        // STEP 7: Face matched + not voted
        // --------------------------------------------------------

        console.log(
            `[AUTHENTICATION] User ${userId} successfully verified`
        );


        res.json({
            success: true,
            message:
                'Face verified successfully. You may vote.',
            user: {
                id: user.id,
                name: user.name
            }
        });


    } catch (error) {

        console.error(
            'Face verify error:',
            error
        );

        res.status(500).json({
            success: false,
            message:
                'Face verification failed',
            error:
                error.message
        });

    }

});


// ============================================================
// VOTE
// ============================================================

app.post('/vote', async (req, res) => {

    try {

        const {
            userId,
            party
        } = req.body;


        if (!userId || !party) {

            return res.status(400).json({
                success: false,
                message:
                    'User ID and party are required'
            });

        }


        // --------------------------------------------------------
        // Check voter
        // --------------------------------------------------------

        const userCheck = await db.query(
            'SELECT voted FROM users WHERE id = $1',
            [userId]
        );


        if (userCheck.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message:
                    'User not found'
            });

        }


        // PostgreSQL BOOLEAN returns true/false
        if (userCheck.rows[0].voted === true) {

            return res.status(400).json({
                success: false,
                message:
                    'You have already voted'
            });

        }


        // --------------------------------------------------------
        // Store vote
        // --------------------------------------------------------

        await db.query(
            `INSERT INTO votes
            (user_id, party_name)
            VALUES
            ($1, $2)`,
            [userId, party]
        );


        // --------------------------------------------------------
        // Mark voter as having voted
        // --------------------------------------------------------

        await db.query(
            `UPDATE users
             SET voted = TRUE
             WHERE id = $1`,
            [userId]
        );


        res.json({
            success: true,
            message:
                'Vote cast successfully'
        });


    } catch (error) {

        console.error(
            'Vote error:',
            error
        );

        res.status(500).json({
            success: false,
            message:
                'Voting failed',
            error:
                error.message
        });

    }

});


// ============================================================
// RESULTS
// ============================================================

app.get('/results', async (req, res) => {

    try {

        const result = await db.query(
            `SELECT
                party_name,
                COUNT(*) as votes
             FROM votes
             GROUP BY party_name
             ORDER BY votes DESC`
        );


        const results =
            result.rows.map(r => ({

                party_name:
                    r.party_name,

                votes:
                    parseInt(r.votes)

            }));


        res.json(results);

    } catch (error) {

        console.error(
            'Results error:',
            error
        );

        res.status(500).json({
            success: false,
            message:
                'Failed to fetch results'
        });

    }

});


// ============================================================
// START SERVER
// ============================================================

const PORT =
    process.env.PORT || 5000;

app.listen(PORT, () => {

    console.log(
        `Server running on port ${PORT}`
    );

});