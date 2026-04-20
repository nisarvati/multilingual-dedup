const BASE_URL = "http://localhost:8000";

export const uploadCSV = async (file) => {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${BASE_URL}/upload`, {
    method: "POST",
    body: formData,
  });

  return res.json();
};

export const runPipeline = async (data) => {
  const res = await fetch(`${BASE_URL}/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  return res.json();
};

export const getStatus = async (jobId) => {
  const res = await fetch(`${BASE_URL}/status/${jobId}`);
  return res.json();
};

export const getResults = async (jobId) => {
  const res = await fetch(`${BASE_URL}/results/${jobId}`);
  return res.json();
};

export const getExplanation = async (payload) => {
  const res = await fetch(`${BASE_URL}/explain`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return res.json();
};