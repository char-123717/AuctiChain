/**
 * IPFS Service - Upload files to IPFS via Pinata
 */

const axios = require('axios');
const FormData = require('form-data');

const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_SECRET_KEY = process.env.PINATA_SECRET_KEY;
const PINATA_JWT = process.env.PINATA_JWT;

/**
 * Upload a file buffer to IPFS via Pinata
 * @param {Buffer} fileBuffer - The file buffer to upload
 * @param {string} fileName - Original filename
 * @returns {Promise<string>} - The IPFS CID (hash)
 */
async function uploadToIPFS(fileBuffer, fileName) {
    // Check if Pinata is configured
    if (!PINATA_JWT && (!PINATA_API_KEY || !PINATA_SECRET_KEY)) {
        console.warn('⚠️  Pinata not configured. Using mock CID.');
        // Return a mock CID for development
        return `mock-cid-${Date.now()}-${fileName.replace(/[^a-zA-Z0-9]/g, '')}`;
    }

    try {
        const formData = new FormData();
        formData.append('file', fileBuffer, {
            filename: fileName,
            contentType: 'application/octet-stream'
        });

        // Optional: Add metadata
        const metadata = JSON.stringify({
            name: fileName,
            keyvalues: {
                uploadedAt: new Date().toISOString(),
                platform: 'auction-dapp'
            }
        });
        formData.append('pinataMetadata', metadata);

        // Optional: Pin options
        const options = JSON.stringify({
            cidVersion: 1
        });
        formData.append('pinataOptions', options);

        // Prepare headers
        const headers = {
            ...formData.getHeaders()
        };

        if (PINATA_JWT) {
            headers['Authorization'] = `Bearer ${PINATA_JWT}`;
        } else {
            headers['pinata_api_key'] = PINATA_API_KEY;
            headers['pinata_secret_api_key'] = PINATA_SECRET_KEY;
        }

        const response = await axios.post(
            'https://api.pinata.cloud/pinning/pinFileToIPFS',
            formData,
            {
                maxBodyLength: Infinity,
                headers
            }
        );

        if (response.data && response.data.IpfsHash) {
            console.log('✅ File uploaded to IPFS:', response.data.IpfsHash);
            return response.data.IpfsHash;
        }

        throw new Error('Invalid response from Pinata');
    } catch (error) {
        console.error('❌ IPFS upload error:', error.response?.data || error.message);
        throw new Error('Failed to upload to IPFS');
    }
}

/**
 * Get the gateway URL for an IPFS CID
 * @param {string} cid - The IPFS CID
 * @returns {string} - The gateway URL
 */
function getIPFSUrl(cid) {
    if (!cid) return null;
    if (cid.startsWith('http')) return cid;
    if (cid.startsWith('mock-cid-')) {
        // Return empty string for mock CIDs (no placeholder)
        return '';
    }
    // Use Pinata gateway or public gateway
    const gateway = process.env.IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs';
    return `${gateway}/${cid}`;
}

/**
 * Unpin a file from Pinata
 * @param {string} cid - The IPFS CID to unpin
 * @returns {Promise<boolean>}
 */
async function unpinFromIPFS(cid) {
    if (!PINATA_JWT && (!PINATA_API_KEY || !PINATA_SECRET_KEY)) {
        console.warn('⚠️  Pinata not configured. Skipping unpin.');
        return true;
    }

    if (cid.startsWith('mock-cid-')) {
        return true;
    }

    try {
        const headers = {};
        if (PINATA_JWT) {
            headers['Authorization'] = `Bearer ${PINATA_JWT}`;
        } else {
            headers['pinata_api_key'] = PINATA_API_KEY;
            headers['pinata_secret_api_key'] = PINATA_SECRET_KEY;
        }

        await axios.delete(`https://api.pinata.cloud/pinning/unpin/${cid}`, { headers });
        console.log('✅ File unpinned from IPFS:', cid);
        return true;
    } catch (error) {
        console.error('❌ IPFS unpin error:', error.response?.data || error.message);
        return false;
    }
}

module.exports = {
    uploadToIPFS,
    getIPFSUrl,
    unpinFromIPFS
};
