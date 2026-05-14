import axios from "axios";

export async function chargeCard(amount: number): Promise<unknown> {
  return axios.post("https://payments.example.com/charge", { amount });
}
